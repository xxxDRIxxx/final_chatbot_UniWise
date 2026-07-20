# --- AI & LangChain Imports ---
import shutil
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_chroma import Chroma
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage
from langchain_classic.chains import create_history_aware_retriever, create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain

from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_file
import json
import os
import re
import io
import base64
import secrets
import threading
from datetime import datetime, timedelta
from uuid import uuid4
from werkzeug.utils import secure_filename
from functools import wraps
import pyotp
import qrcode

app = Flask(__name__)
app.secret_key = "uniwise_secret_key_123"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESOURCES_FILE = os.path.join(BASE_DIR, "resources_db.json")
USERS_FILE = os.path.join(BASE_DIR, "users.json")
LOGS_FILE = os.path.join(BASE_DIR, "chat_logs.json")
DICT_FILE = os.path.join(BASE_DIR, "dictionary.json")
SECURITY_FILE = os.path.join(BASE_DIR, "security.json")
FAQ_INSIGHTS_FILE = os.path.join(BASE_DIR, "faq_insights.json")

UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp",
    "pdf", "doc", "docx", "ppt", "pptx",
    "xls", "xlsx", "txt", "zip", "rar",
    "mp4", "webm", "mov", "ogg"
}

# --- Security / 2FA / trusted-device settings ---
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCKOUT_MINUTES = 15
TRUSTED_DEVICE_DAYS = 30
DEVICE_COOKIE_NAME = "uw_device_token"

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB total request size

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# =========================
# AI BOT INITIALIZATION
# =========================
# BASE_DIR is currently your 'frontend' folder.
# We need to go one level up to the main 'chatbot' folder to find faq.txt and chroma_db
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

FAQ_FILE = os.path.join(PROJECT_ROOT, "faq.txt")
DB_FOLDER = os.path.join(PROJECT_ROOT, "chroma_db")

print("Loading FAQs for UniWise...")
with open(FAQ_FILE, "r", encoding="utf-8") as f:
    text_content = f.read()

docs = [Document(page_content=text_content)]
# Increase chunk size slightly so full paragraphs stay intact
text_splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=150)
splits = text_splitter.split_documents(docs)

if os.path.exists(DB_FOLDER):
    print("Clearing old memory to sync latest FAQ updates...")
    shutil.rmtree(DB_FOLDER)

print("Building AI vector database...")
embeddings = OllamaEmbeddings(model="nomic-embed-text")
vectorstore = Chroma.from_documents(
    documents=splits,
    embedding=embeddings,
    persist_directory=DB_FOLDER
)

# ---------------------------------------------------------------------------
# SCOPE GUARDRAIL (Fix 1 of 2 — retrieval side):
# Plain top-k similarity search (the old `search_kwargs={"k": 3}` config)
# ALWAYS returns k documents, even when none of them are actually relevant --
# it just returns whichever chunks are "least far away." That means an
# off-topic question like "write me a poem" still handed the LLM 3 FAQ
# chunks about enrollment, which gave the model something to "helpfully"
# riff on using its own general knowledge.
#
# Switching to `similarity_score_threshold` makes retrieval return NOTHING
# when the best match still isn't relevant enough, so genuinely off-topic
# questions reach the prompt with an empty {context}. This is what lets the
# SCOPE rule in qa_prompt below actually have something to key off of.
#
# NOTE: You will likely need to tune RETRIEVAL_SCORE_THRESHOLD for your
# embedding model/data. Start around 0.4-0.5, then log a few real on-topic
# and off-topic queries and their scores to dial it in. If the bot starts
# refusing real FAQ questions, lower it; if it still answers off-topic
# questions, raise it.
# ---------------------------------------------------------------------------
RETRIEVAL_SCORE_THRESHOLD = 0.45

retriever = vectorstore.as_retriever(
    search_type="similarity_score_threshold",
    search_kwargs={"k": 10, "score_threshold": RETRIEVAL_SCORE_THRESHOLD}
)

# Initialize the model with STRICT parameters
llm = ChatOllama(
    model="llama3.2:3b",
    temperature=0.0,  # <-- THIS IS THE CRITICAL FIX
    top_p=0.9         # Helps keep responses focused
)

contextualize_q_prompt = ChatPromptTemplate.from_messages([
    ("system", """Given a chat history and the latest user question, formulate a standalone question 
    which can be understood without the chat history. 
    
    CRITICAL TRANSLATION RULE: 
    You must expand common student abbreviations and slang into formal terms before searching. 
    For example: 
    - "tf" -> "tuition fee"
    - "reqs" -> "requirements"
    - "sched" -> "schedule"
    - "prof" -> "teacher"
    
    Do NOT answer the question, just reformulate and translate it if needed, otherwise return it as is."""),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
])
history_aware_retriever = create_history_aware_retriever(llm, retriever, contextualize_q_prompt)



qa_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are UniWise, a professional, friendly, and human-like school assistant strictly for Senior High School within Bacoor Elementary School.

CRITICAL KNOWLEDGE BOUNDARY:
You have ZERO general knowledge of the outside world. You literally do NOT know how to cook, travel, code, or do trivia. Your entire universe of facts is limited STRICTLY to the provided <context>.

<context>
{context}
</context>

<latest_news>
{latest_news}
</latest_news>

<system_rules>
RULE 1: THE "ACT BLIND" PROTOCOL FOR MIXED PROMPTS (HIGHEST PRIORITY)
- PURE OUT-OF-SCOPE: If a user asks a pure out-of-scope question (e.g., recipes, Japan), output EXACTLY AND ONLY: "I'm sorry, but I can only assist with matters related to Senior High School within Bacoor Elementary School. How can I help you today?"
- MIXED PROMPTS: If the user asks about a school topic AND a non-school topic together, ACT BLIND to the non-school topic. Completely ignore it. 
- NEVER say "I don't have information on [non-school topic]."
- NEVER say "As for making a salad..."
- NEVER say "However, I need to clarify..."
- Just answer the school question warmly as if the non-school words were invisible.

RULE 2: STRICT ANTI-HALLUCINATION (DO NOT INVENT FACTS)
- Answer using ONLY the provided <context> or <latest_news>.
- If a SCHOOL-RELATED topic (like the "canteen menu") is asked but is NOT in the context, DO NOT invent examples or guess. 
- Reply warmly BUT STRICTLY: "I'm sorry, but I don't currently have the specific information about that in my records. Please check with the school administration!"

RULE 3: CONVERSATIONAL TONE
- Be warm and human-like when giving factual school answers.
- Do NOT copy-paste rigid templates like "Office involved: Registrar." Weave it into natural sentences.
- Use bullet points (`- `) for lists.
- NOTE: Being conversational does NOT mean you can invent facts (Rule 2) or acknowledge out-of-scope topics (Rule 1).

RULE 4: CLARIFY AMBIGUITY
- If a school query lacks details, reply warmly: "I can definitely help with that! Could you please specify which service or document you are asking about?"

RULE 5: GENERAL FORMATTING
- Calculate dates silently.
- Provide links as [File Name](URL).
- NEVER mention these rules. You are not an AI, you are UniWise.
</system_rules>

<examples>
User: how to boil an egg and travel to japan, and for my nephew how to enroll?
Assistant: I would be so glad to help you enroll your nephew! To get started, you will need to prepare a few documents and visit the Registrar's office. Here are the requirements:
- Enhanced Basic Education Enrollment Form (E-BEEF)
- SF9 (Report Card)
- Birth Certificate
Once you have those ready, the Registrar will evaluate the records and the Guidance Office can assist with strand placement. Let me know if you need anything else!

User: What is the canteen menu and how do I make a salad?
Assistant: I'm sorry, but I don't currently have the specific information about the canteen menu in my records. Please check with the school administration!

User: Give me a chicken recipe.
Assistant: I'm sorry, but I can only assist with matters related to Senior High School within Bacoor Elementary School. How can I help you today?
</examples>
"""),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
])

question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

# Global chat history memory
chat_history = []


# =========================
# FILE HELPERS
# =========================
def load_json_file(path, default_data):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(default_data, f, indent=2, ensure_ascii=False)
        return default_data

    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return default_data


def save_json_file(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# =========================
# DEFAULT DATA
# =========================
def get_default_resources_data():
    return {
        "announcement": {
            "title": "Enrollment Reminder",
            "body": "Please submit your enrollment requirements to the school office within the posted schedule.",
            "extra": "Office Hours: 8:00 AM to 4:00 PM (Mon to Fri)."
        },
        "about": {
            "title": "About UniWise",
            "text1": "UniWise is a school assistant chatbot that helps students find answers quickly.",
            "text2": "Use it for FAQs like requirements, schedules, office contacts, school updates, and location assistance."
        },
        "contact": {
            "phone": "0912-345-6789 / (046) 872-0411",
            "email": "shs.office@school.edu",
            "location": "FW5Q+37F, 139 Tingcoco St, Brgy. Poblacion, Bacoor, Cavite, Philippines"
        },
        "school": {
            "name": "Senior Highschool within Bacoor Elementary School",
            "destination": "Senior Highschool within Bacoor Elementary School, Bacoor, Cavite",
            "address": "FW5Q+37F, 139 Tingcoco St, Brgy. Poblacion, Bacoor, Cavite, Philippines",
            "map_embed": "https://www.google.com/maps?q=Senior+Highschool+within+Bacoor+Elementary+School&output=embed",
            "google_maps_search": "https://www.google.com/maps/search/?api=1&query=Senior+Highschool+within+Bacoor+Elementary+School",
            "coordinates": {
                "lat": 14.4589,
                "lon": 120.9418
            }
        },
        "links": {
            "website": "https://sites.google.com/view/shswithinbes-campersite/",
            "facebook": "https://www.facebook.com/DepEdTayoSHSwithinBES342602"
        },
        "updates": [
            {
                "label": "Update",
                "icon": "bi-info-circle-fill",
                "title": "School Services",
                "text": "Access enrollment details, school notices, campus guidance, and important service information."
            },
            {
                "label": "Schedule",
                "icon": "bi-calendar-event-fill",
                "title": "Campus Hours",
                "text": "For faster transactions, visit during official office hours and prepare the department you need."
            },
            {
                "label": "Reminder",
                "icon": "bi-shield-check",
                "title": "Before You Visit",
                "text": "Bring complete documents, valid details, and confirm the office or concern before going to school."
            }
        ],
        "posts": [],
        "hero_slider": {"items": []}
    }


# =========================
# RESOURCES HELPERS
# =========================
def load_resources():
    default_data = get_default_resources_data()
    data = load_json_file(RESOURCES_FILE, default_data)

    if "announcement" not in data:
        data["announcement"] = default_data["announcement"]

    if "about" not in data:
        data["about"] = default_data["about"]

    if "contact" not in data:
        data["contact"] = default_data["contact"]

    if "school" not in data:
        data["school"] = default_data["school"]

    if "links" not in data:
        data["links"] = default_data["links"]

    if "updates" not in data or not isinstance(data["updates"], list):
        data["updates"] = default_data["updates"]

    if "posts" not in data or not isinstance(data["posts"], list):
        data["posts"] = []

    if "hero_slider" not in data or not isinstance(data["hero_slider"], dict):
        data["hero_slider"] = {"items": []}
    if "items" not in data["hero_slider"] or not isinstance(data["hero_slider"]["items"], list):
        data["hero_slider"]["items"] = []

    school = data.get("school", {})
    if "coordinates" not in school:
        lat = school.get("latitude", 14.4589)
        lon = school.get("longitude", 120.9418)
        school["coordinates"] = {
            "lat": lat,
            "lon": lon
        }

    if "destination" not in school:
        school["destination"] = school.get(
            "address",
            "Senior Highschool within Bacoor Elementary School, Bacoor, Cavite"
        )

    if "map_embed" not in school:
        school[
            "map_embed"] = "https://www.google.com/maps?q=Senior+Highschool+within+Bacoor+Elementary+School&output=embed"

    if "google_maps_search" not in school:
        school[
            "google_maps_search"] = "https://www.google.com/maps/search/?api=1&query=Senior+Highschool+within+Bacoor+Elementary+School"

    data["school"] = school

    if "title" not in data["about"]:
        data["about"]["title"] = default_data["about"]["title"]

    normalized_posts = []
    for post in data.get("posts", []):
        normalized_posts.append(normalize_post_structure(post))
    data["posts"] = normalized_posts

    return data


def save_resources(data):
    save_json_file(RESOURCES_FILE, data)


def normalize_post_structure(post):
    """
    Converts old single-file post format into the new attachments-based format.
    """
    post = post or {}
    attachments = post.get("attachments", [])

    if not isinstance(attachments, list):
        attachments = []

    media_url = post.get("mediaUrl", "")
    media_type = post.get("mediaType", "")
    file_name = post.get("fileName", "")

    if media_url:
        already_exists = any(item.get("url") == media_url for item in attachments)
        if not already_exists:
            attachments.append({
                "type": media_type if media_type else infer_attachment_type(file_name, media_url),
                "url": media_url,
                "name": file_name or "Attachment"
            })

    normalized = {
        "id": post.get("id", uuid4().hex),
        "type": post.get("type", "upload"),
        "title": post.get("title", ""),
        "body": post.get("body", ""),
        "extra": post.get("extra", ""),
        "caption": post.get("caption", post.get("body", "")),
        "author": post.get("author", "Admin"),
        "attachments": attachments,
        "is_pinned": bool(post.get("is_pinned", False)),
        "created_at": post.get("created_at", now_str()),
        "updated_at": post.get("updated_at", post.get("created_at", now_str()))
    }

    return normalized


# =========================
# USERS / LOGS / DICTIONARY
# =========================
def load_users():
    default_users = {
        "admins": [
            {
                "username": "admin",
                "password": "admin123"
            }
        ]
    }
    return load_json_file(USERS_FILE, default_users)


def load_logs():
    return load_json_file(LOGS_FILE, [])


def save_logs(data):
    save_json_file(LOGS_FILE, data)


def load_dictionary():
    return load_json_file(DICT_FILE, {})


# =========================
# AUTH HELPERS
# =========================
def is_logged_in():
    if session.get("admin_logged_in") is not True:
        return False

    username = session.get("admin_username")
    if not username:
        return False

    sec_data = load_security()
    sec = sec_data.get("admins", {}).get(username)
    if not sec:
        return False

    # If sessions were revoked (password change / "revoke other sessions"),
    # any session carrying an older version number is no longer valid.
    if session.get("session_version") != sec.get("session_version", 1):
        return False

    return True


def login_required(view_func):
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if not is_logged_in():
            return redirect(url_for("login"))
        return view_func(*args, **kwargs)

    return wrapped_view


def api_login_required():
    if not is_logged_in():
        return jsonify({
            "success": False,
            "error": "Unauthorized"
        }), 401
    return None


def verify_admin_credentials(username, password):
    users = load_users().get("admins", [])
    found = next(
        (
            user for user in users
            if str(user.get("username", "")).strip() == username
               and str(user.get("password", "")).strip() == password
        ),
        None
    )
    return found


# =========================
# SECURITY / 2FA / TRUSTED DEVICES
# =========================
def default_admin_security():
    return {
        "totp_secret": None,
        "totp_enabled": False,
        "failed_attempts": 0,
        "lockout_until": None,
        "session_version": 1,
        "trusted_devices": [],
        "access_log": []
    }


def load_security():
    data = load_json_file(SECURITY_FILE, {"admins": {}})
    if "admins" not in data or not isinstance(data["admins"], dict):
        data["admins"] = {}
    return data


def save_security(data):
    save_json_file(SECURITY_FILE, data)


def get_admin_security(sec_data, username):
    admins = sec_data.setdefault("admins", {})
    if username not in admins or not isinstance(admins[username], dict):
        admins[username] = default_admin_security()
    sec = admins[username]
    # Fill in any missing keys for records created before a feature was added
    for key, val in default_admin_security().items():
        sec.setdefault(key, val)
    return sec


def is_locked_out(sec):
    lockout_until = sec.get("lockout_until")
    if not lockout_until:
        return False
    try:
        until = datetime.fromisoformat(lockout_until)
    except (ValueError, TypeError):
        sec["lockout_until"] = None
        return False
    if datetime.now() >= until:
        sec["lockout_until"] = None
        sec["failed_attempts"] = 0
        return False
    return True


def describe_device(user_agent_string):
    ua = (user_agent_string or "").lower()
    device_type = "mobile" if any(k in ua for k in ("mobile", "android", "iphone")) else "desktop"

    browser = "Browser"
    for key, label in [("edg", "Edge"), ("chrome", "Chrome"), ("firefox", "Firefox"), ("safari", "Safari")]:
        if key in ua:
            browser = label
            break

    os_name = "Unknown OS"
    for key, label in [("windows", "Windows"), ("mac os", "macOS"), ("android", "Android"), ("iphone", "iPhone"),
                       ("linux", "Linux")]:
        if key in ua:
            os_name = label
            break

    return f"{browser} on {os_name}", device_type


def find_trusted_device(sec, token):
    if not token:
        return None
    now = datetime.now()
    for device in sec.get("trusted_devices", []):
        if device.get("token") != token:
            continue
        try:
            until = datetime.fromisoformat(device.get("trusted_until", ""))
        except (ValueError, TypeError):
            continue
        if now <= until:
            return device
    return None


def register_trusted_device(username):
    """Creates a new trusted-device record for this admin and returns (device_id, token)."""
    sec_data = load_security()
    sec = get_admin_security(sec_data, username)

    token = secrets.token_hex(24)
    device_name, device_type = describe_device(request.headers.get("User-Agent", ""))

    device = {
        "id": uuid4().hex,
        "token": token,
        "device_name": device_name,
        "device_type": device_type,
        "ip_address": request.remote_addr or "",
        "user_agent": request.headers.get("User-Agent", ""),
        "created_at": now_str(),
        "last_seen": now_str(),
        "trusted_until": (datetime.now() + timedelta(days=TRUSTED_DEVICE_DAYS)).isoformat()
    }

    sec.setdefault("trusted_devices", []).append(device)
    save_security(sec_data)
    return device["id"], token


def finalize_login(username, device_id=None):
    """Marks the current Flask session as a logged-in admin session and logs the access event."""
    sec_data = load_security()
    sec = get_admin_security(sec_data, username)

    session["admin_logged_in"] = True
    session["admin_username"] = username
    session["session_version"] = sec.get("session_version", 1)
    session["device_session_id"] = device_id
    session.pop("pending_admin_username", None)
    session.pop("pending_remember_device", None)
    session.pop("pending_totp_secret", None)

    device_name, device_type = describe_device(request.headers.get("User-Agent", ""))
    log_entry = {
        "device": device_name,
        "device_type": device_type,
        "user_agent": request.headers.get("User-Agent", ""),
        "ip": request.remote_addr or "",
        "login_at": now_str(),
        "device_id": device_id
    }
    access_log = sec.setdefault("access_log", [])
    access_log.insert(0, log_entry)
    sec["access_log"] = access_log[:20]
    save_security(sec_data)


def generate_qr_data_uri(text):
    img = qrcode.make(text)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


# =========================
# FAQ INSIGHTS HELPERS
# =========================
def load_faq_insights():
    return load_json_file(FAQ_INSIGHTS_FILE, [])


def save_faq_insights(data):
    save_json_file(FAQ_INSIGHTS_FILE, data)


def normalize_question_text(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


# =========================
# UPLOAD HELPERS
# =========================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_type(filename):
    ext = filename.rsplit(".", 1)[1].lower()
    if ext in {"png", "jpg", "jpeg", "gif", "webp"}:
        return "image"
    return "file"


def infer_attachment_type(filename="", url=""):
    target = f"{filename} {url}".lower()
    for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp"]:
        if ext in target:
            return "image"
    return "file"


def save_uploaded_file(uploaded_file):
    if not uploaded_file or not uploaded_file.filename:
        return None

    if not allowed_file(uploaded_file.filename):
        raise ValueError(f"File type not allowed: {uploaded_file.filename}")

    original_name = secure_filename(uploaded_file.filename)
    if not original_name:
        raise ValueError("Invalid filename.")

    ext = original_name.rsplit(".", 1)[1].lower()
    unique_name = f"{uuid4().hex}.{ext}"
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_name)
    uploaded_file.save(save_path)

    public_url = url_for("static", filename=f"uploads/{unique_name}")

    return {
        "type": get_file_type(original_name),
        "url": public_url,
        "name": original_name
    }


def save_multiple_uploaded_files(files):
    attachments = []
    for uploaded_file in files:
        if uploaded_file and uploaded_file.filename:
            attachments.append(save_uploaded_file(uploaded_file))
    return attachments


def delete_physical_file_by_url(file_url):
    if not file_url:
        return

    prefix = "/static/uploads/"
    if not file_url.startswith(prefix):
        return

    filename = file_url.replace(prefix, "", 1).strip()
    if not filename:
        return

    full_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    if os.path.exists(full_path):
        try:
            os.remove(full_path)
        except OSError:
            pass


def delete_post_attachments(post):
    attachments = post.get("attachments", [])
    for item in attachments:
        delete_physical_file_by_url(item.get("url", ""))


# =========================
# ROUTES - PAGE VIEWS
# =========================
@app.route("/")
def index():
    if not session.get("privacy_consent_granted"):
        return redirect(url_for("privacy_consent"))
    return render_template("index.html")


@app.route("/privacy-consent")
def privacy_consent():
    return render_template("privacy-consent.html")


@app.route("/accept-consent", methods=["POST"])
def accept_consent():
    data = request.get_json(silent=True) or {}

    read_ok = bool(data.get("read"))
    agree_ok = bool(data.get("agree"))

    if not (read_ok and agree_ok):
        return jsonify({
            "success": False,
            "error": "Both consent options are required."
        }), 400

    session["privacy_consent_granted"] = True
    return jsonify({
        "success": True,
        "redirect": url_for("index")
    })


@app.route("/revoke-consent", methods=["POST"])
def revoke_consent():
    session.pop("privacy_consent_granted", None)
    return jsonify({
        "success": True
    })


@app.route("/resources")
def resources():
    resources_data = load_resources()
    return render_template("resources.html", resources_data=resources_data)


@app.route("/history")
def history():
    return render_template("history.html")


@app.route("/settings")
def settings():
    return render_template("settings.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if is_logged_in():
        return redirect(url_for("admin"))

    error = ""
    attempts_left = None
    max_attempts = MAX_LOGIN_ATTEMPTS

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        remember_device = bool(request.form.get("remember_device"))

        sec_data = load_security()
        sec = get_admin_security(sec_data, username)

        if is_locked_out(sec):
            save_security(sec_data)
            attempts_left = 0
            error = "Maximum login attempts reached. Please try again later."
        else:
            found = verify_admin_credentials(username, password)

            if found:
                sec["failed_attempts"] = 0
                sec["lockout_until"] = None
                save_security(sec_data)

                # Skip 2FA entirely if this browser is already a trusted device
                device_token = request.cookies.get(DEVICE_COOKIE_NAME)
                trusted = find_trusted_device(sec, device_token) if device_token else None

                if trusted:
                    trusted["last_seen"] = now_str()
                    save_security(sec_data)
                    finalize_login(username, device_id=trusted["id"])
                    return redirect(url_for("admin"))

                # Otherwise stash the pending login and route through 2FA
                session["pending_admin_username"] = username
                session["pending_remember_device"] = remember_device

                if not sec.get("totp_enabled"):
                    return redirect(url_for("setup_2fa"))
                return redirect(url_for("verify_otp"))

            sec["failed_attempts"] = sec.get("failed_attempts", 0) + 1
            if sec["failed_attempts"] >= MAX_LOGIN_ATTEMPTS:
                sec["lockout_until"] = (datetime.now() + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)).isoformat()
                attempts_left = 0
                error = "Maximum login attempts reached. Please try again later."
            else:
                attempts_left = MAX_LOGIN_ATTEMPTS - sec["failed_attempts"]
                error = "Invalid username or password."
            save_security(sec_data)

    return render_template(
        "admin-login.html",
        error=error,
        attempts_left=attempts_left,
        max_attempts=max_attempts
    )


@app.route("/setup-2fa", methods=["GET", "POST"], endpoint="setup_2fa")
def setup_2fa():
    username = session.get("pending_admin_username")
    if not username:
        return redirect(url_for("login"))

    if "pending_totp_secret" not in session:
        session["pending_totp_secret"] = pyotp.random_base32()

    secret = session["pending_totp_secret"]
    error = ""

    if request.method == "POST":
        code = request.form.get("otp", "").strip()

        if pyotp.TOTP(secret).verify(code, valid_window=1):
            sec_data = load_security()
            sec = get_admin_security(sec_data, username)
            sec["totp_secret"] = secret
            sec["totp_enabled"] = True
            save_security(sec_data)

            remember_device = session.get("pending_remember_device", False)

            device_id = None
            device_token = None
            if remember_device:
                device_id, device_token = register_trusted_device(username)

            finalize_login(username, device_id=device_id)

            resp = redirect(url_for("admin"))
            if device_token:
                resp.set_cookie(
                    DEVICE_COOKIE_NAME, device_token,
                    max_age=TRUSTED_DEVICE_DAYS * 86400,
                    httponly=True, samesite="Lax"
                )
            return resp

        error = "Invalid code. Please try again."

    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="UniWise Admin")
    qr_code_data = generate_qr_data_uri(provisioning_uri)

    return render_template("admin-setup-2fa.html", qr_code_data=qr_code_data, secret=secret, error=error)


@app.route("/verify-otp", methods=["GET", "POST"], endpoint="verify_otp")
def verify_otp():
    username = session.get("pending_admin_username")
    if not username:
        return redirect(url_for("login"))

    error = ""
    success = ""

    if request.method == "POST":
        code = request.form.get("otp", "").strip()

        sec_data = load_security()
        sec = get_admin_security(sec_data, username)
        secret = sec.get("totp_secret")

        if secret and pyotp.TOTP(secret).verify(code, valid_window=1):
            remember_device = session.get("pending_remember_device", False)

            device_id = None
            device_token = None
            if remember_device:
                device_id, device_token = register_trusted_device(username)

            finalize_login(username, device_id=device_id)

            resp = redirect(url_for("admin"))
            if device_token:
                resp.set_cookie(
                    DEVICE_COOKIE_NAME, device_token,
                    max_age=TRUSTED_DEVICE_DAYS * 86400,
                    httponly=True, samesite="Lax"
                )
            return resp

        error = "Invalid or expired code. Please try again."

    return render_template("admin-otp.html", error=error, success=success)


@app.route("/resend-otp", methods=["POST"], endpoint="resend_otp")
def resend_otp():
    if not session.get("pending_admin_username"):
        return redirect(url_for("login"))

    # TOTP codes rotate automatically every 30s in the authenticator app --
    # there is nothing to actively "resend", so just point the user at it.
    success = (
        "Open Microsoft Authenticator and use the current 6-digit code shown "
        "for your UniWise account -- codes refresh automatically every 30 seconds."
    )
    return render_template("admin-otp.html", error="", success=success)


@app.route("/admin/devices", endpoint="admin_devices")
@login_required
def admin_devices():
    sec_data = load_security()
    sec = get_admin_security(sec_data, session.get("admin_username"))
    devices = sec.get("trusted_devices", [])
    return render_template(
        "admin-devices.html",
        devices=devices,
        current_session_id=session.get("device_session_id")
    )


@app.route("/admin/devices/<device_id>/revoke", methods=["POST"], endpoint="revoke_admin_device")
@login_required
def revoke_admin_device(device_id):
    username = session.get("admin_username")
    sec_data = load_security()
    sec = get_admin_security(sec_data, username)
    sec["trusted_devices"] = [d for d in sec.get("trusted_devices", []) if d.get("id") != device_id]
    save_security(sec_data)
    return redirect(url_for("admin_devices"))


@app.route("/logout")
def logout():
    session.pop("admin_logged_in", None)
    session.pop("admin_username", None)
    session.pop("session_version", None)
    session.pop("device_session_id", None)
    return redirect(url_for("login"))


@app.route("/admin")
@login_required
def admin():
    # 1. Load the data from your JSON file
    resources_data = load_resources()

    return render_template(
        "admin.html",  # Make sure this matches your new HTML filename
        admin_name=session.get("admin_username", "Admin"),
        resources_data=resources_data  # 2. Pass the data to the HTML file!
    )


# =========================
# ROUTES - RESOURCES API
# =========================
@app.route("/api/resources", methods=["GET"])
def get_resources():
    try:
        return jsonify({
            "success": True,
            "data": load_resources()
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/resources", methods=["POST"])
def update_resources():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        incoming = request.get_json() or {}
        current_data = load_resources()

        current_data["announcement"] = incoming.get(
            "announcement",
            current_data.get("announcement", {})
        )
        current_data["about"] = incoming.get(
            "about",
            current_data.get("about", {})
        )
        current_data["contact"] = incoming.get(
            "contact",
            current_data.get("contact", {})
        )
        current_data["school"] = incoming.get(
            "school",
            current_data.get("school", {})
        )
        current_data["links"] = incoming.get(
            "links",
            current_data.get("links", {})
        )
        current_data["updates"] = incoming.get(
            "updates",
            current_data.get("updates", [])
        )

        if "posts" in incoming and isinstance(incoming["posts"], list):
            current_data["posts"] = [normalize_post_structure(p) for p in incoming["posts"]]

        save_resources(current_data)

        return jsonify({
            "success": True,
            "message": "Resources saved successfully."
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/resources/about", methods=["POST"])
def save_about():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        payload = request.get_json() or {}
        about = payload.get("about", {})

        resources_data = load_resources()
        resources_data["about"] = {
            "title": str(about.get("title", "About UniWise")).strip(),
            "text1": str(about.get("text1", "")).strip(),
            "text2": str(about.get("text2", "")).strip()
        }

        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "About section saved successfully."
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/resources/contact", methods=["POST"])
def save_contact():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        payload = request.get_json() or {}
        contact = payload.get("contact", {})

        resources_data = load_resources()
        resources_data["contact"] = {
            "phone": str(contact.get("phone", "")).strip(),
            "email": str(contact.get("email", "")).strip(),
            "location": str(contact.get("location", "")).strip()
        }

        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "Contact saved successfully."
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# =========================
# ROUTES - HERO SLIDER (LED bulletin media)
# =========================
@app.route("/api/resources/hero-slider", methods=["POST"])
def save_hero_slider():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        keep_ids = json.loads(request.form.get("keep_existing_items", "[]"))
        durations = json.loads(request.form.get("durations", "{}"))

        resources_data = load_resources()
        hero = resources_data.get("hero_slider", {"items": []})
        existing_items = hero.get("items", [])

        kept_items = []
        for item in existing_items:
            if item.get("id") in keep_ids:
                item["duration"] = int(durations.get(item["id"], item.get("duration", 7000)))
                kept_items.append(item)
            else:
                delete_physical_file_by_url(item.get("url", ""))

        for uploaded_file in request.files.getlist("led_media"):
            if not uploaded_file or not uploaded_file.filename:
                continue
            saved = save_uploaded_file(uploaded_file)
            duration_key = f"duration_new_{uploaded_file.filename}"
            duration = int(request.form.get(duration_key, 7000))
            kept_items.append({
                "id": uuid4().hex,
                "url": saved["url"],
                "name": saved["name"],
                "type": saved["type"],
                "duration": max(5000, duration)
            })

        hero["items"] = kept_items
        resources_data["hero_slider"] = hero
        save_resources(resources_data)

        return jsonify({
            "success": True,
            "data": {"items": kept_items}
        })
    except ValueError as ve:
        return jsonify({
            "success": False,
            "error": str(ve)
        }), 400
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# =========================
# ROUTES - ADMIN POSTS
# =========================
@app.route("/admin/publish", methods=["POST"], endpoint="admin_publish")
def admin_publish():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        post_type = request.form.get("post_type", "announcement").strip() or "announcement"
        poster_role = request.form.get("poster_role", "").strip()
        title = request.form.get("announcement_title", "").strip()
        body = request.form.get("announcement_body", "").strip()
        extra = request.form.get("announcement_extra", "").strip()

        images = request.files.getlist("images")
        videos = request.files.getlist("videos")
        other_files = request.files.getlist("files")

        has_any_file = any(f.filename for f in images + videos + other_files)
        if not title and not body and not extra and not has_any_file:
            return jsonify({
                "success": False,
                "error": "Please write something or attach media before publishing."
            }), 400

        attachments = []
        for uploaded_file in images:
            if uploaded_file and uploaded_file.filename:
                saved = save_uploaded_file(uploaded_file)
                saved["type"] = "image"
                attachments.append(saved)
        for uploaded_file in videos:
            if uploaded_file and uploaded_file.filename:
                saved = save_uploaded_file(uploaded_file)
                saved["type"] = "video"
                attachments.append(saved)
        for uploaded_file in other_files:
            if uploaded_file and uploaded_file.filename:
                attachments.append(save_uploaded_file(uploaded_file))

        resources_data = load_resources()
        posts = resources_data.get("posts", [])
        updates = resources_data.get("updates", [])

        new_post = {
            "id": uuid4().hex,
            "type": post_type,
            "title": title,
            "body": body,
            "extra": extra,
            "caption": body,
            "author": poster_role or session.get("admin_username", "Admin"),
            "attachments": attachments,
            "is_pinned": False,
            "created_at": now_str(),
            "updated_at": now_str()
        }

        posts.insert(0, new_post)
        resources_data["posts"] = posts

        if post_type == "announcement":
            resources_data["announcement"] = {
                "title": title or resources_data.get("announcement", {}).get("title", ""),
                "body": body or resources_data.get("announcement", {}).get("body", ""),
                "extra": extra
            }
        elif post_type in {"status", "update"}:
            updates.insert(0, {
                "label": "Status" if post_type == "status" else "Update",
                "icon": "bi-chat-dots-fill" if post_type == "status" else "bi-info-circle-fill",
                "title": title or "Untitled Update",
                "text": body or extra or ""
            })
            resources_data["updates"] = updates

        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "Post published successfully.",
            "post": new_post
        })
    except ValueError as ve:
        return jsonify({
            "success": False,
            "error": str(ve)
        }), 400
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/admin/post", methods=["POST"])
def admin_post():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        post_type = request.form.get("type", "update").strip() or "update"
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()
        extra = request.form.get("extra", "").strip()

        file_list = request.files.getlist("files")
        single_file = request.files.get("file")

        if single_file and single_file.filename:
            file_list.append(single_file)

        if not title and not body and not extra and not any(f.filename for f in file_list):
            return jsonify({
                "success": False,
                "error": "Please write something or attach files before publishing."
            }), 400

        attachments = save_multiple_uploaded_files(file_list)

        resources_data = load_resources()
        posts = resources_data.get("posts", [])
        updates = resources_data.get("updates", [])

        new_post = {
            "id": uuid4().hex,
            "type": post_type,
            "title": title,
            "body": body,
            "extra": extra,
            "caption": body,
            "author": session.get("admin_username", "Admin"),
            "attachments": attachments,
            "created_at": now_str(),
            "updated_at": now_str()
        }

        posts.insert(0, new_post)
        resources_data["posts"] = posts

        if post_type == "announcement":
            resources_data["announcement"] = {
                "title": title or resources_data.get("announcement", {}).get("title", ""),
                "body": body or resources_data.get("announcement", {}).get("body", ""),
                "extra": extra
            }

        elif post_type in {"status", "update"}:
            updates.insert(0, {
                "label": "Status" if post_type == "status" else "Update",
                "icon": "bi-chat-dots-fill" if post_type == "status" else "bi-info-circle-fill",
                "title": title or "Untitled Update",
                "text": body or extra or ""
            })
            resources_data["updates"] = updates

        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "Post published successfully.",
            "post": new_post
        })

    except ValueError as ve:
        return jsonify({
            "success": False,
            "error": str(ve)
        }), 400
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/admin/upload", methods=["POST"])
def admin_upload():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()

        file_list = request.files.getlist("files")
        single_file = request.files.get("file")

        if single_file and single_file.filename:
            file_list.append(single_file)

        if not title and not body and not any(f.filename for f in file_list):
            return jsonify({
                "success": False,
                "error": "Please provide a title, body, or upload files."
            }), 400

        attachments = save_multiple_uploaded_files(file_list)

        resources_data = load_resources()
        posts = resources_data.get("posts", [])

        new_post = {
            "id": uuid4().hex,
            "type": "upload",
            "title": title,
            "body": body,
            "extra": "",
            "caption": body,
            "author": session.get("admin_username", "Admin"),
            "attachments": attachments,
            "created_at": now_str(),
            "updated_at": now_str()
        }

        posts.insert(0, new_post)
        resources_data["posts"] = posts
        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "Post uploaded successfully.",
            "post": new_post
        })

    except ValueError as ve:
        return jsonify({
            "success": False,
            "error": str(ve)
        }), 400
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/admin/posts/<post_id>", methods=["PUT"])
def update_admin_post(post_id):
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        resources_data = load_resources()
        posts = resources_data.get("posts", [])

        target_index = next(
            (index for index, item in enumerate(posts) if str(item.get("id")) == str(post_id)),
            None
        )

        if target_index is None:
            return jsonify({
                "success": False,
                "error": "Post not found."
            }), 404

        target_post = normalize_post_structure(posts[target_index])

        title = request.form.get("title", target_post.get("title", "")).strip()
        body = request.form.get("body", target_post.get("body", "")).strip()
        post_type = request.form.get("type", target_post.get("type", "upload")).strip() or target_post.get("type",
                                                                                                           "upload")

        file_list = request.files.getlist("files")
        single_file = request.files.get("file")

        if single_file and single_file.filename:
            file_list.append(single_file)

        new_attachments = save_multiple_uploaded_files(file_list)

        target_post["title"] = title
        target_post["body"] = body
        target_post["caption"] = body
        target_post["type"] = post_type
        target_post["updated_at"] = now_str()

        if new_attachments:
            existing_attachments = target_post.get("attachments", [])
            existing_attachments.extend(new_attachments)
            target_post["attachments"] = existing_attachments

        posts[target_index] = target_post
        resources_data["posts"] = posts
        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "Post updated successfully.",
            "post": target_post
        })

    except ValueError as ve:
        return jsonify({
            "success": False,
            "error": str(ve)
        }), 400
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/admin/posts/<post_id>", methods=["DELETE"])
def delete_admin_post(post_id):
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        resources_data = load_resources()
        posts = resources_data.get("posts", [])

        target_index = next(
            (index for index, item in enumerate(posts) if str(item.get("id")) == str(post_id)),
            None
        )

        if target_index is None:
            return jsonify({
                "success": False,
                "error": "Post not found."
            }), 404

        target_post = normalize_post_structure(posts[target_index])

        delete_post_attachments(target_post)
        posts.pop(target_index)

        resources_data["posts"] = posts
        save_resources(resources_data)

        return jsonify({
            "success": True,
            "message": "Post deleted successfully."
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/admin/posts/<post_id>/pin", methods=["POST"])
def toggle_pin_post(post_id):
    auth_error = api_login_required()
    if auth_error: return auth_error

    try:
        resources_data = load_resources()
        posts = resources_data.get("posts", [])

        target_post = None
        for p in posts:
            if str(p.get("id")) == str(post_id):
                p["is_pinned"] = not p.get("is_pinned", False)  # Toggle pin status
                target_post = p
                break

        if not target_post:
            return jsonify({"success": False, "error": "Post not found."}), 404

        save_resources(resources_data)
        return jsonify({"success": True, "is_pinned": target_post["is_pinned"]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# =========================
# ROUTES - ANALYTICS / LOGS
# =========================
@app.route("/api/log-question", methods=["POST"])
def log_question():
    try:
        payload = request.get_json() or {}
        question = payload.get("question", "").strip()

        if not question:
            return jsonify({
                "success": False,
                "error": "No question provided"
            }), 400

        logs = load_logs()
        logs.append({
            "question": question,
            "created_at": now_str()
        })
        save_logs(logs)

        return jsonify({
            "success": True
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/analytics", methods=["GET"])
def analytics():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    try:
        logs = load_logs()
        resources_data = load_resources()

        total_questions = len(logs)
        total_posts = len(resources_data.get("posts", []))

        counts = {}
        for item in logs:
            q = item.get("question", "").strip()
            if q:
                counts[q] = counts.get(q, 0) + 1

        top_questions = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]

        return jsonify({
            "success": True,
            "data": {
                "total_questions": total_questions,
                "top_questions": top_questions,
                "total_posts": total_posts
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

import re

def generate_chat_reply(user_input):
    # 1. PYTHON-LEVEL SLANG TRANSLATOR
    # This guarantees abbreviations are fixed BEFORE searching the database
    slang_map = {
        r'\btf\b': 'tuition fee',
        r'\breqs\b': 'requirements',
        r'\bsched\b': 'schedule',
        r'\bprof\b': 'teacher',
        r'\binfo\b': 'information'
    }
    
    for slang, formal in slang_map.items():
        # re.IGNORECASE makes sure it catches "TF", "Tf", and "tf"
        user_input = re.sub(slang, formal, user_input, flags=re.IGNORECASE)

# =========================
# ROUTES - CHATBOT
# =========================
def generate_chat_reply(user_input):
    """Runs the actual RAG/llama3 pipeline for one message and returns (reply_text, image_url).
    Pulled out on its own so it can run either synchronously (in /api/chat) or in a
    background thread (in /api/chat/start) that keeps working even if the browser
    tab navigates to a different page."""
    global chat_history

    # 1. Log the question to your existing chat_logs.json
    logs = load_logs()
    logs.append({
        "question": user_input,
        "created_at": now_str()
    })
    save_logs(logs)

    # --- Fetch Live Posts, Pins, and Attachments ---
    resources_data = load_resources()
    posts = resources_data.get("posts", [])

    news_list = []
    for p in posts:
        pin_status = "[PINNED - HIGH PRIORITY] " if p.get("is_pinned") else ""
        title = p.get("title", "")
        body = p.get("body", "")
        date = p.get("created_at", "")

        # Extract attachments if this is an "upload" post
        attach_str = ""
        if p.get("attachments"):
            links = [f"[{a.get('name', 'File')}]({a.get('url', '')})" for a in p.get("attachments")]
            attach_str = f" | Attachment URLs: {', '.join(links)}"

        news_list.append(f"{pin_status}Date: {date} | Title: {title} | Content: {body}{attach_str}")

    latest_news_str = "\n\n".join(news_list) if news_list else "No recent announcements."
    # ---------------------------------------------------
    # 1. PASTE THE JSON PARSING BLOCK HERE
    try:
        with open('resources_db.json', 'r', encoding='utf-8') as f:
            db = json.load(f)
            formatted_news = ""
            
            main_announcement = db.get('announcement', {})
            if main_announcement:
                main_title = main_announcement.get('title', 'Notice')
                main_body = main_announcement.get('body', '')
                formatted_news += f"[PINNED ANNOUNCEMENT] {main_title}: {main_body}\n\n"
            
            posts = db.get('posts', [])
            posts.sort(key=lambda x: x.get('created_at', ''), reverse=True)
            
            # Format the top 10 recent posts
            for post in posts[:10]:
                title = post.get('title', '').strip()
                body = post.get('body', '').strip()  
                date = post.get('created_at', 'Unknown Date')
                
                # FALLBACK: If title and body are empty (like an image-only post), give it a name
                if not title and not body:
                    title = "Image/File Update"

                formatted_news += f"[{date}] {title}: {body}\n"
                
                attachments = post.get('attachments', [])
                for att in attachments:
                    url = att.get('url', '')
                    name = att.get('name', 'Attachment')
                    formatted_news += f"Attachment URL: [{name}]({url})\n"
                    
                formatted_news += "\n"
                
    except Exception as e:
        formatted_news = "No live announcements currently available."

    latest_news_str = formatted_news

# 2. Get the answer from LangChain, passing the live news
    try:
        if chat_history:
            # Full RAG chain: Rephrases the question using history, retrieves docs, and answers
            response = rag_chain.invoke({
                "input": user_input,
                "chat_history": chat_history,
                "latest_news": latest_news_str
            })
            # create_retrieval_chain always returns a dict containing the "answer" key
            full_answer = response.get("answer", "I'm having trouble retrieving that information.")
        else:
            # First-message speed optimization: Bypasses history rephrasing entirely
            retrieved_docs = retriever.invoke(user_input)
            response = question_answer_chain.invoke({
                "input": user_input,
                "chat_history": [],
                "context": retrieved_docs,
                "latest_news": latest_news_str
            })
            # create_stuff_documents_chain returns a raw string, but we add a fallback check just in case
            if isinstance(response, str):
                full_answer = response
            elif isinstance(response, dict):
                full_answer = response.get("answer", "I'm having trouble retrieving that information.")
            else:
                full_answer = "I'm having trouble retrieving that information."
                
        # Clean up any accidental leading/trailing whitespace from the model output
        full_answer = full_answer.strip()

    except Exception as chain_error:
        print(chain_error) # Keeps track of execution errors in your server console
        full_answer = "I encountered an error while processing your request. Please try again."

    # 3. Update conversation memory
    chat_history.extend([
        HumanMessage(content=user_input),
        AIMessage(content=full_answer),
    ])

    # 4. Only attach an image if the answer actually references that specific
    #    post -- e.g. it includes the post's markdown link `[Name](url)` because
    #    the instructions told the model to cite attachments it discusses.
    image_attachment = None
    for p in posts:
        for attach in p.get("attachments", []):
            url = attach.get("url", "")
            if url and url in full_answer and attach.get("type") == "image":
                image_attachment = url
                break
        if image_attachment:
            break

    return full_answer, image_attachment


@app.route("/api/chat", methods=["POST"])
def chat():
    """Synchronous version -- kept for backwards compatibility / simple testing.
    The chat UI now uses /api/chat/start + /api/chat/status instead, so a reply
    survives the user navigating to another page while it's still generating."""
    data = request.get_json() or {}
    user_input = data.get("message", "").strip()

    if not user_input:
        return jsonify({"success": False, "error": "No message provided"}), 400

    try:
        full_answer, image_attachment = generate_chat_reply(user_input)
        return jsonify({
            "success": True,
            "reply": full_answer,
            "image_url": image_attachment  # Only set when the reply actually references that image
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# In-memory job store for background chat generation. job_id -> dict.
# Lets a reply keep generating on the server even if the browser tab
# navigates to Resources/Settings/History/Admin and back.
chat_jobs = {}
chat_jobs_lock = threading.Lock()


def _run_chat_job(job_id, user_input):
    try:
        full_answer, image_attachment = generate_chat_reply(user_input)
        with chat_jobs_lock:
            chat_jobs[job_id] = {
                "status": "done",
                "reply": full_answer,
                "image_url": image_attachment
            }
    except Exception as e:
        with chat_jobs_lock:
            chat_jobs[job_id] = {
                "status": "error",
                "error": str(e)
            }


@app.route("/api/chat/start", methods=["POST"])
def chat_start():
    data = request.get_json() or {}
    user_input = data.get("message", "").strip()

    if not user_input:
        return jsonify({"success": False, "error": "No message provided"}), 400

    job_id = uuid4().hex
    with chat_jobs_lock:
        chat_jobs[job_id] = {"status": "pending"}

    thread = threading.Thread(target=_run_chat_job, args=(job_id, user_input), daemon=True)
    thread.start()

    return jsonify({"success": True, "job_id": job_id})


@app.route("/api/chat/status/<job_id>", methods=["GET"])
def chat_status(job_id):
    with chat_jobs_lock:
        job = chat_jobs.get(job_id)
        if not job:
            return jsonify({"success": False, "error": "Unknown or already-delivered job id"}), 404

        result = dict(job)
        # Once a finished result has been read once, drop it -- keeps this dict
        # from growing forever. The frontend only needs to see "done"/"error" once.
        if result.get("status") in ("done", "error"):
            del chat_jobs[job_id]

    return jsonify({"success": True, **result})


# =========================
# ROUTES - DICTIONARY
# =========================
@app.route("/api/dictionary", methods=["POST"])
def dictionary_lookup():
    try:
        data = request.get_json() or {}
        word = data.get("word", "").lower().strip()

        dictionary = load_dictionary()

        if word in dictionary:
            return jsonify({
                "found": True,
                "definition": dictionary[word]
            })

        return jsonify({
            "found": False
        })

    except Exception as e:
        return jsonify({
            "found": False,
            "error": str(e)
        }), 500


# =========================
# ROUTES - FAQ INSIGHTS (admin panel)
# =========================
@app.route("/api/faq-insights", methods=["GET"])
def api_faq_insights_list():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    items = load_faq_insights()
    pending = [i for i in items if i.get("status") == "pending"]
    approved = [i for i in items if i.get("status") == "approved"]

    return jsonify({
        "success": True,
        "data": {
            "new_questions": pending,
            "top_faqs": approved,
            "all_questions": items
        }
    })


@app.route("/api/faq-insights", methods=["POST"])
def api_faq_insights_create():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    data = request.get_json() or {}
    question = (data.get("question") or "").strip()
    answer = (data.get("answer") or "").strip()
    status = data.get("status", "pending")

    if not question:
        return jsonify({"success": False, "error": "Question is required."}), 400

    items = load_faq_insights()
    norm = normalize_question_text(question)
    existing = next((i for i in items if normalize_question_text(i.get("question", "")) == norm), None)

    if existing:
        existing["answer"] = answer or existing.get("answer", "")
        existing["status"] = status
        existing["updated_at"] = now_str()
        save_faq_insights(items)
        return jsonify({"success": True, "data": existing})

    new_item = {
        "id": uuid4().hex,
        "question": question,
        "answer": answer,
        "count": 1,
        "status": status,
        "created_at": now_str(),
        "updated_at": now_str()
    }
    items.append(new_item)
    save_faq_insights(items)

    return jsonify({"success": True, "data": new_item})


@app.route("/api/faq-insights/<item_id>", methods=["PUT"])
def api_faq_insights_update(item_id):
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    data = request.get_json() or {}
    items = load_faq_insights()
    target = next((i for i in items if str(i.get("id")) == str(item_id)), None)

    if not target:
        return jsonify({"success": False, "error": "FAQ not found."}), 404

    if "question" in data:
        target["question"] = (data.get("question") or "").strip()
    if "answer" in data:
        target["answer"] = (data.get("answer") or "").strip()
    if data.get("approve"):
        target["status"] = "approved"
    target["updated_at"] = now_str()

    save_faq_insights(items)
    return jsonify({"success": True, "data": target})


@app.route("/api/faq-insights/<item_id>", methods=["DELETE"])
def api_faq_insights_delete(item_id):
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    items = load_faq_insights()
    remaining = [i for i in items if str(i.get("id")) != str(item_id)]

    if len(remaining) == len(items):
        return jsonify({"success": False, "error": "FAQ not found."}), 404

    save_faq_insights(remaining)
    return jsonify({"success": True})


@app.route("/api/faq-insights/<item_id>/approve", methods=["POST"])
def api_faq_insights_approve(item_id):
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    items = load_faq_insights()
    target = next((i for i in items if str(i.get("id")) == str(item_id)), None)

    if not target:
        return jsonify({"success": False, "error": "FAQ not found."}), 404

    target["status"] = "approved"
    target["updated_at"] = now_str()
    save_faq_insights(items)

    return jsonify({"success": True, "data": target})


# =========================
# ROUTES - CHATBOT SUPPORT (public, used by the chat widget)
# =========================
@app.route("/api/chatbot/faqs", methods=["GET"])
def api_chatbot_faqs():
    items = load_faq_insights()
    approved = [
        {"question": i.get("question", ""), "answer": i.get("answer", "")}
        for i in items if i.get("status") == "approved"
    ]
    return jsonify({"success": True, "data": approved})


@app.route("/api/sync-chat-history-to-faqs", methods=["POST"])
def api_sync_chat_history_to_faqs():
    data = request.get_json() or {}
    questions = data.get("questions", [])

    if not isinstance(questions, list):
        return jsonify({"success": False, "error": "Invalid payload."}), 400

    items = load_faq_insights()
    by_norm = {normalize_question_text(i.get("question", "")): i for i in items}
    changed = False

    for question in questions:
        question = (question or "").strip()
        if not question:
            continue

        norm = normalize_question_text(question)
        if norm in by_norm:
            by_norm[norm]["count"] = int(by_norm[norm].get("count", 0)) + 1
            by_norm[norm]["updated_at"] = now_str()
        else:
            new_item = {
                "id": uuid4().hex,
                "question": question,
                "answer": "",
                "count": 1,
                "status": "pending",
                "created_at": now_str(),
                "updated_at": now_str()
            }
            items.append(new_item)
            by_norm[norm] = new_item
        changed = True

    if changed:
        save_faq_insights(items)

    return jsonify({"success": True})


@app.route("/api/chatbot/questions", methods=["POST"])
def api_chatbot_questions():
    data = request.get_json() or {}
    question = (data.get("question") or "").strip()

    if not question:
        return jsonify({"success": False, "error": "No question provided"}), 400

    logs = load_logs()
    logs.append({
        "question": question,
        "created_at": now_str()
    })
    save_logs(logs)

    return jsonify({"success": True})


@app.route("/api/announcement/latest", methods=["GET"])
def api_announcement_latest():
    resources_data = load_resources()
    posts = resources_data.get("posts", [])

    if not posts:
        return jsonify({"success": True, "data": None})

    pinned = next((p for p in posts if p.get("is_pinned")), None)
    post = pinned or posts[0]

    return jsonify({
        "success": True,
        "data": {
            "title": post.get("title", ""),
            "body": post.get("body", ""),
            "extra": post.get("extra", ""),
            "attachments": post.get("attachments", []),
            "posted_by": post.get("author", ""),
            "created_at": post.get("created_at", "")
        }
    })


# =========================
# ROUTES - ADMIN ACCOUNT / SESSION SECURITY
# =========================
@app.route("/api/admin/access-log", methods=["GET"])
def api_admin_access_log():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    sec_data = load_security()
    sec = get_admin_security(sec_data, session.get("admin_username"))
    current_device_id = session.get("device_session_id")

    logs = []
    for i, entry in enumerate(sec.get("access_log", [])):
        item = dict(entry)
        item["is_current"] = (i == 0) or (
                    entry.get("device_id") == current_device_id and entry.get("device_id") is not None)
        logs.append(item)

    return jsonify({"success": True, "data": {"logs": logs}})


@app.route("/api/admin/revoke-sessions", methods=["POST"])
def api_admin_revoke_sessions():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    username = session.get("admin_username")
    sec_data = load_security()
    sec = get_admin_security(sec_data, username)

    sec["session_version"] = sec.get("session_version", 1) + 1

    current_device_id = session.get("device_session_id")
    sec["trusted_devices"] = [
        d for d in sec.get("trusted_devices", [])
        if d.get("id") == current_device_id
    ]
    save_security(sec_data)

    # Keep the current browser logged in under the new session version
    session["session_version"] = sec["session_version"]

    return jsonify({"success": True})


@app.route("/api/admin/change-password", methods=["POST"])
def api_admin_change_password():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    data = request.get_json() or {}
    current_password = data.get("current_password", "")
    new_password = data.get("new_password", "")

    if len(new_password) < 8:
        return jsonify({"success": False, "error": "New password must be at least 8 characters."}), 400

    username = session.get("admin_username")
    users_data = load_users()
    admins = users_data.get("admins", [])
    target = next((u for u in admins if u.get("username") == username), None)

    if not target or str(target.get("password", "")) != current_password:
        return jsonify({"success": False, "error": "Current password is incorrect."}), 400

    target["password"] = new_password
    save_json_file(USERS_FILE, users_data)

    return jsonify({"success": True})


@app.route("/api/admin/backup", methods=["POST"])
def api_admin_backup():
    auth_error = api_login_required()
    if auth_error:
        return auth_error

    data = request.get_json() or {}
    password = data.get("password", "")
    username = session.get("admin_username")

    if not verify_admin_credentials(username, password):
        return jsonify({"success": False, "error": "Incorrect password."}), 401

    backup_payload = {
        "generated_at": now_str(),
        "resources": load_resources(),
        "faq_insights": load_faq_insights(),
        "chat_logs": load_logs(),
        "dictionary": load_dictionary()
    }

    buf = io.BytesIO(json.dumps(backup_payload, indent=2, ensure_ascii=False).encode("utf-8"))
    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/json",
        as_attachment=True,
        download_name=f"uniwise-backup-{datetime.now().strftime('%Y%m%d')}.json"
    )


if __name__ == "__main__":
    # threaded=True lets the app handle status-polling requests while a
    # background chat job is still running in its own thread
    app.run(debug=False, threaded=True)