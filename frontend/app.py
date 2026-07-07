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

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import json
import os
from datetime import datetime
from uuid import uuid4
from werkzeug.utils import secure_filename
from functools import wraps

app = Flask(__name__)
app.secret_key = "uniwise_secret_key_123"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESOURCES_FILE = os.path.join(BASE_DIR, "resources_db.json")
USERS_FILE = os.path.join(BASE_DIR, "users.json")
LOGS_FILE = os.path.join(BASE_DIR, "chat_logs.json")
DICT_FILE = os.path.join(BASE_DIR, "dictionary.json")

UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp",
    "pdf", "doc", "docx", "ppt", "pptx",
    "xls", "xlsx", "txt", "zip", "rar"
}

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
text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
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
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

llm = ChatOllama(model="llama3")

contextualize_q_prompt = ChatPromptTemplate.from_messages([
    ("system", """Given a chat history and the latest user question, formulate a standalone question 
    which can be understood without the chat history. Do NOT answer the question, 
    just reformulate it if needed and otherwise return it as is."""),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
])
history_aware_retriever = create_history_aware_retriever(llm, retriever, contextualize_q_prompt)

qa_prompt = ChatPromptTemplate.from_messages([
    ("system", """You are UniWise, a professional and friendly school assistant for Senior High School within Bacoor Elementary School.
    
    Context from our FAQ: {context}
    
    LATEST LIVE ANNOUNCEMENTS & POSTS:
    {latest_news}
    
    Strict Instructions:
    1. GREETINGS: Only introduce yourself if the user explicitly types a greeting.
    2. DEFAULT TO BRIEF: Provide brief, 1-to-2 sentence answers. 
    3. DATE MATH: Calculate dates silently. If a post from July 7 says "tomorrow", state July 8.
    4. PINNED POSTS: Always prioritize information from posts marked [PINNED - HIGH PRIORITY].
    5. ATTACHMENTS (CRITICAL): If an announcement contains an 'Attachment URL', you MUST provide that link to the user in your response using this exact markdown format: [File Name](URL). Do not leave out the link if they ask about the post!
    6. ANTI-HALLUCINATION: NEVER invent steps or fees.
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
        "posts": []
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
        school["map_embed"] = "https://www.google.com/maps?q=Senior+Highschool+within+Bacoor+Elementary+School&output=embed"

    if "google_maps_search" not in school:
        school["google_maps_search"] = "https://www.google.com/maps/search/?api=1&query=Senior+Highschool+within+Bacoor+Elementary+School"

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
    return session.get("admin_logged_in") is True


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

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        found = verify_admin_credentials(username, password)

        if found:
            session["admin_logged_in"] = True
            session["admin_username"] = username
            return redirect(url_for("admin"))

        error = "Invalid username or password."

    return render_template("admin-login.html", error=error)


@app.route("/logout")
def logout():
    session.pop("admin_logged_in", None)
    session.pop("admin_username", None)
    return redirect(url_for("login"))


@app.route("/admin")
@login_required
def admin():
    # 1. Load the data from your JSON file
    resources_data = load_resources()
    
    return render_template(
        "admin.html", # Make sure this matches your new HTML filename
        admin_name=session.get("admin_username", "Admin"),
        resources_data=resources_data # 2. Pass the data to the HTML file!
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
# ROUTES - ADMIN POSTS
# =========================
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
        post_type = request.form.get("type", target_post.get("type", "upload")).strip() or target_post.get("type", "upload")

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
                p["is_pinned"] = not p.get("is_pinned", False) # Toggle pin status
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

# =========================
# ROUTES - CHATBOT
# =========================
@app.route("/api/chat", methods=["POST"])
def chat():
    global chat_history
    
    data = request.get_json() or {}
    user_input = data.get("message", "").strip()
    
    if not user_input:
        return jsonify({"success": False, "error": "No message provided"}), 400

    try:
        # 1. Log the question to your existing chat_logs.json
        logs = load_logs()
        logs.append({
            "question": user_input,
            "created_at": now_str()
        })
        save_logs(logs)

# --- NEW: Fetch Live Posts, Pins, and Attachments ---
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

        # 2. Get the answer from LangChain, passing the live news
        response = rag_chain.invoke({
            "input": user_input, 
            "chat_history": chat_history,
            "latest_news": latest_news_str
        })
        full_answer = response.get("answer", "I'm having trouble retrieving that information.")
        
        # 3. Update conversation memory
        chat_history.extend([
            HumanMessage(content=user_input),
            AIMessage(content=full_answer),
        ])
        
        # 4. Return the JSON payload to the frontend
        image_attachment = None
        # Check the first post/announcement for an attachment
        recent_posts = posts[:1] 
        if recent_posts and recent_posts[0].get("attachments"):
            # Filter for image type
            for attach in recent_posts[0].get("attachments"):
                if attach.get("type") == "image":
                    image_attachment = attach.get("url")
                    break

        return jsonify({
            "success": True, 
            "reply": full_answer,
            "image_url": image_attachment # Send the URL explicitly to the UI
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

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


if __name__ == "__main__":
    app.run(debug=False)