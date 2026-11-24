from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from pathlib import Path
from datetime import datetime, timedelta

import uuid
import json
import hashlib
import shutil
import asyncio

app = FastAPI(title="Sharing Data API")

# =====================================================
# TRANSFER LOCKS
# =====================================================

transfer_locks = {}


def get_transfer_lock(transfer_id: str):

    if transfer_id not in transfer_locks:
        transfer_locks[transfer_id] = asyncio.Lock()

    return transfer_locks[transfer_id]
# =====================================================
# PUBLIC FRONTEND URL
# =====================================================

FRONTEND_URL = (
    "https://sandra-holder-blocking-here.trycloudflare.com"
)


# =====================================================
# CORS
# =====================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://sandra-holder-blocking-here.trycloudflare.com",
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================
# DIRECTORIES
# =====================================================

# Metadata stays with the backend
TRANSFER_DIR = Path("transfers")

# Store large file chunks on E: drive
CHUNK_DIR = Path(r"E:\sharing-data-storage\chunks")

TRANSFER_DIR.mkdir(
    parents=True,
    exist_ok=True
)

CHUNK_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# =====================================================
# SETTINGS
# =====================================================

CHUNK_SIZE = 10 * 1024 * 1024

MAX_RECEIVERS = 3
MAX_DOWNLOADS = 3

TRANSFER_HOURS = 3


# =====================================================
# PASSWORD HASH
# =====================================================

def hash_password(password: str):

    return hashlib.sha256(
        password.encode()
    ).hexdigest()


# =====================================================
# READ TRANSFER
# =====================================================

def get_transfer(transfer_id: str):

    metadata_file = (
        TRANSFER_DIR /
        f"{transfer_id}.json"
    )

    if not metadata_file.exists():

        raise HTTPException(
            status_code=404,
            detail="Transfer not found"
        )

    with open(
        metadata_file,
        "r"
    ) as file:

        return json.load(file)


# =====================================================
# SAVE TRANSFER
# =====================================================

def save_transfer(
    transfer_id,
    transfer
):

    metadata_file = (
        TRANSFER_DIR /
        f"{transfer_id}.json"
    )

    temporary_file = (
        TRANSFER_DIR /
        f"{transfer_id}.tmp"
    )

    with open(
        temporary_file,
        "w"
    ) as file:

        json.dump(
            transfer,
            file,
            indent=4
        )

    temporary_file.replace(
        metadata_file
    )


# =====================================================
# CHECK EXPIRATION
# =====================================================

def check_expiration(transfer):

    expires_at = datetime.fromisoformat(
        transfer["expires_at"]
    )

    if datetime.now() > expires_at:

        raise HTTPException(
            status_code=410,
            detail="This transfer has expired"
        )


# =====================================================
# HOME
# =====================================================

@app.get("/")
def home():

    return {
        "message": "Sharing Data Backend Running"
    }


# =====================================================
# INITIALIZE TRANSFER
# =====================================================

@app.post("/init-transfer")
async def init_transfer(

    password: str = Form(...),

    files_info: str = Form(...)

):

    if not password.strip():

        raise HTTPException(
            status_code=400,
            detail="Password cannot be empty"
        )


    try:

        files = json.loads(files_info)

    except Exception:

        raise HTTPException(
            status_code=400,
            detail="Invalid file information"
        )


    if not files:

        raise HTTPException(
            status_code=400,
            detail="No files selected"
        )


    transfer_id = uuid.uuid4().hex


    created_at = datetime.now()

    expires_at = (
        created_at +
        timedelta(
            hours=TRANSFER_HOURS
        )
    )


    transfer_files = []


    for index, file in enumerate(files):

        try:

            original_name = str(
                file["name"]
            )

            file_size = int(
                file["size"]
            )

            total_chunks = int(
                file["total_chunks"]
            )

        except Exception:

            raise HTTPException(
                status_code=400,
                detail="Invalid file information"
            )


        safe_name = Path(
            original_name
        ).name


        if file_size <= 0:

            raise HTTPException(
                status_code=400,
                detail="Invalid file size"
            )


        if total_chunks <= 0:

            raise HTTPException(
                status_code=400,
                detail="Invalid chunk count"
            )


        transfer_files.append({

            "index": index,

            "name": safe_name,

            "size": file_size,

            "total_chunks": total_chunks,

            "uploaded_chunks": [],

            "completed": False

        })


    transfer_data = {

        "transfer_id":
            transfer_id,

        "password_hash":
            hash_password(password),

        "files":
            transfer_files,

        "created_at":
            created_at.isoformat(),

        "expires_at":
            expires_at.isoformat(),

        "max_receivers":
            MAX_RECEIVERS,

        "receiver_count":
            0,

        "max_downloads":
            MAX_DOWNLOADS,

        "download_count":
            0,

        "completed":
            False

    }


    save_transfer(
        transfer_id,
        transfer_data
    )


    transfer_chunk_folder = (
        CHUNK_DIR /
        transfer_id
    )


    transfer_chunk_folder.mkdir(
        parents=True,
        exist_ok=True
    )


    return {

        "message":
            "Transfer initialized",

        "transfer_id":
            transfer_id,

        "chunk_size":
            CHUNK_SIZE,

        "expires_at":
            expires_at.isoformat()

    }


# =====================================================
# UPLOAD CHUNK
# =====================================================

@app.post("/upload-chunk")
async def upload_chunk(

    transfer_id: str = Form(...),

    file_index: int = Form(...),

    chunk_index: int = Form(...),

    chunk: UploadFile = File(...)

):

    # Lock this transfer so parallel uploads
    # cannot overwrite each other's metadata.
    lock = get_transfer_lock(transfer_id)

    async with lock:

        transfer = get_transfer(
            transfer_id
        )

        check_expiration(
            transfer
        )

        if transfer["completed"]:

            raise HTTPException(
                status_code=400,
                detail="Transfer already completed"
            )

        # ---------------------------------------------
        # Validate file index
        # ---------------------------------------------

        if (
            file_index < 0
            or
            file_index >= len(
                transfer["files"]
            )
        ):

            raise HTTPException(
                status_code=400,
                detail="Invalid file index"
            )

        file_info = transfer["files"][
            file_index
        ]

        # ---------------------------------------------
        # Validate chunk index
        # ---------------------------------------------

        if (
            chunk_index < 0
            or
            chunk_index >= file_info[
                "total_chunks"
            ]
        ):

            raise HTTPException(
                status_code=400,
                detail="Invalid chunk index"
            )

        # ---------------------------------------------
        # Chunk folder
        # ---------------------------------------------

        file_chunk_folder = (
            CHUNK_DIR /
            transfer_id /
            str(file_index)
        )

        file_chunk_folder.mkdir(
            parents=True,
            exist_ok=True
        )

        chunk_path = (
            file_chunk_folder /
            f"{chunk_index}.part"
        )

        # ---------------------------------------------
        # Already uploaded
        # ---------------------------------------------

        if chunk_path.exists():

            if (
                chunk_index
                not in
                file_info["uploaded_chunks"]
            ):

                file_info[
                    "uploaded_chunks"
                ].append(
                    chunk_index
                )

                save_transfer(
                    transfer_id,
                    transfer
                )

            return {

                "message":
                    "Chunk already uploaded",

                "file_index":
                    file_index,

                "chunk_index":
                    chunk_index

            }

        # ---------------------------------------------
        # Save chunk
        # ---------------------------------------------

        with open(
            chunk_path,
            "wb"
        ) as output:

            while True:

                data = await chunk.read(
                    1024 * 1024
                )

                if not data:
                    break

                output.write(data)

        # ---------------------------------------------
        # Record uploaded chunk
        # ---------------------------------------------

        if (
            chunk_index
            not in
            file_info["uploaded_chunks"]
        ):

            file_info[
                "uploaded_chunks"
            ].append(
                chunk_index
            )

        # ---------------------------------------------
        # Check file completion
        # ---------------------------------------------

        if len(
            file_info["uploaded_chunks"]
        ) == file_info["total_chunks"]:

            file_info[
                "completed"
            ] = True

        # ---------------------------------------------
        # Save metadata
        # ---------------------------------------------

        save_transfer(
            transfer_id,
            transfer
        )

        return {

            "message":
                "Chunk uploaded",

            "file_index":
                file_index,

            "chunk_index":
                chunk_index,

            "file_completed":
                file_info["completed"]

        }

# =====================================================
# CHECK UPLOADED CHUNKS
# =====================================================

@app.get(
    "/uploaded-chunks/{transfer_id}/{file_index}"
)
async def uploaded_chunks(

    transfer_id: str,

    file_index: int

):

    transfer = get_transfer(
        transfer_id
    )


    check_expiration(
        transfer
    )


    if (
        file_index < 0
        or
        file_index >= len(
            transfer["files"]
        )
    ):

        raise HTTPException(
            status_code=400,
            detail="Invalid file index"
        )


    return {

        "file_index":
            file_index,

        "uploaded_chunks":
            transfer[
                "files"
            ][
                file_index
            ][
                "uploaded_chunks"
            ]

    }


# =====================================================
# COMPLETE TRANSFER
#
# IMPORTANT:
# We DO NOT merge files here.
# =====================================================

@app.post("/complete-transfer")
async def complete_transfer(

    transfer_id: str = Form(...)

):

    transfer = get_transfer(
        transfer_id
    )


    check_expiration(
        transfer
    )


    if transfer["completed"]:

        return {

            "message":
                "Transfer already completed",

            "transfer_id":
                transfer_id,

            "share_link":
                (
                    f"{FRONTEND_URL}"
                    f"/transfer/{transfer_id}"
                ),

            "expires_at":
                transfer["expires_at"]

        }


    # -------------------------------------------------
    # Verify every file
    # -------------------------------------------------

    for file_info in transfer["files"]:

        expected = set(
            range(
                file_info[
                    "total_chunks"
                ]
            )
        )


        uploaded = set(
            file_info[
                "uploaded_chunks"
            ]
        )


        if uploaded != expected:

            missing = sorted(
                expected -
                uploaded
            )


            raise HTTPException(
                status_code=400,
                detail={
                    "message":
                        "Some chunks are missing",

                    "file":
                        file_info["name"],

                    "missing_chunks":
                        missing[:100]
                }
            )


        file_info[
            "completed"
        ] = True


    # -------------------------------------------------
    # Mark transfer complete
    # -------------------------------------------------

    transfer["completed"] = True


    save_transfer(
        transfer_id,
        transfer
    )


    # -------------------------------------------------
    # CREATE LINK IMMEDIATELY
    # -------------------------------------------------

    share_link = (
        f"{FRONTEND_URL}"
        f"/transfer/{transfer_id}"
    )


    return {

        "message":
            "Transfer created successfully",

        "transfer_id":
            transfer_id,

        "expires_at":
            transfer["expires_at"],

        "share_link":
            share_link

    }


# =====================================================
# VERIFY PASSWORD
# =====================================================

@app.post("/verify-transfer")
async def verify_transfer(

    transfer_id: str = Form(...),

    password: str = Form(...)

):

    transfer = get_transfer(
        transfer_id
    )


    check_expiration(
        transfer
    )


    if not transfer["completed"]:

        raise HTTPException(
            status_code=400,
            detail="Transfer is not ready yet"
        )


    entered_hash = hash_password(
        password
    )


    if (
        entered_hash
        !=
        transfer["password_hash"]
    ):

        raise HTTPException(
            status_code=401,
            detail="Incorrect password"
        )


    if (
        transfer["receiver_count"]
        >=
        transfer["max_receivers"]
    ):

        raise HTTPException(
            status_code=403,
            detail="Maximum receiver limit reached"
        )


    transfer["receiver_count"] += 1


    save_transfer(
        transfer_id,
        transfer
    )


    return {

        "message":
            "Password verified",

        "transfer_id":
            transfer_id,

        "files":
            transfer["files"],

        "expires_at":
            transfer["expires_at"],

        "remaining_downloads":
            (
                transfer["max_downloads"]
                -
                transfer["download_count"]
            )

    }


# =====================================================
# STREAM FILE FROM CHUNKS
# =====================================================

async def stream_file_chunks(

    transfer_id: str,

    file_index: int

):

    transfer = get_transfer(
        transfer_id
    )


    file_info = transfer[
        "files"
    ][
        file_index
    ]


    total_chunks = file_info[
        "total_chunks"
    ]


    for chunk_index in range(
        total_chunks
    ):

        chunk_path = (
            CHUNK_DIR /
            transfer_id /
            str(file_index) /
            f"{chunk_index}.part"
        )


        if not chunk_path.exists():

            raise RuntimeError(
                f"Chunk {chunk_index} missing"
            )


        with open(
            chunk_path,
            "rb"
        ) as chunk_file:

            while True:

                data = chunk_file.read(
                    1024 * 1024
                )

                if not data:
                    break

                yield data


# =====================================================
# DOWNLOAD FILE
# =====================================================

@app.get(
    "/download/{transfer_id}/{filename}"
)
async def download_file(

    transfer_id: str,

    filename: str

):

    transfer = get_transfer(
        transfer_id
    )


    check_expiration(
        transfer
    )


    if not transfer["completed"]:

        raise HTTPException(
            status_code=400,
            detail="Transfer is not ready"
        )


    if (
        transfer["download_count"]
        >=
        transfer["max_downloads"]
    ):

        raise HTTPException(
            status_code=403,
            detail="Download limit reached"
        )


    safe_name = Path(
        filename
    ).name


    file_index = None


    for index, file_info in enumerate(
        transfer["files"]
    ):

        if file_info["name"] == safe_name:

            file_index = index

            break


    if file_index is None:

        raise HTTPException(
            status_code=404,
            detail="File not found"
        )


    # -------------------------------------------------
    # Count download
    # -------------------------------------------------

    transfer[
        "download_count"
    ] += 1


    save_transfer(
        transfer_id,
        transfer
    )


    # -------------------------------------------------
    # Stream chunks as ONE file
    # -------------------------------------------------

    return StreamingResponse(

        stream_file_chunks(
            transfer_id,
            file_index
        ),

        media_type="application/octet-stream",

        headers={

            "Content-Disposition":
                (
                    "attachment; "
                    f'filename="{safe_name}"'
                ),

            "Content-Length":
                str(
                    transfer[
                        "files"
                    ][
                        file_index
                    ][
                        "size"
                    ]
                )

        }

    )