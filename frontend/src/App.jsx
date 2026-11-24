import { useRef, useState } from "react";
import "./App.css";

// =====================================================
// BACKEND
// =====================================================

const API_URL = "https://exactly-quantities-columns-fought.trycloudflare.com";

// =====================================================
// CHUNK SETTINGS
// =====================================================

// 10 MB chunks
const CHUNK_SIZE = 10 * 1024 * 1024;

// Number of chunks uploaded together
const MAX_PARALLEL_UPLOADS = 2;

// =====================================================
// SENDER
// =====================================================

function SenderPage() {

  const fileInputRef = useRef(null);

  const [files, setFiles] = useState([]);

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [progress, setProgress] =
    useState(0);

  const [speed, setSpeed] =
    useState(0);

  const [shareLink, setShareLink] =
    useState("");


  // ---------------------------------------------------
  // Select files
  // ---------------------------------------------------

  const handleChooseFiles = () => {

    fileInputRef.current.click();

  };


  const handleFiles = (event) => {

    const selectedFiles =
      Array.from(event.target.files);

    setFiles(selectedFiles);

    setShareLink("");

  };


  // ---------------------------------------------------
  // Upload one chunk
  // ---------------------------------------------------

  const uploadChunk = async (
    transferId,
    fileIndex,
    chunkIndex,
    chunk
  ) => {

    const MAX_RETRIES = 5;

    for (
      let attempt = 1;
      attempt <= MAX_RETRIES;
      attempt++
    ) {

      try {

        const formData =
          new FormData();

        formData.append(
          "transfer_id",
          transferId
        );

        formData.append(
          "file_index",
          fileIndex
        );

        formData.append(
          "chunk_index",
          chunkIndex
        );

        formData.append(
          "chunk",
          chunk,
          `chunk-${chunkIndex}`
        );


        const response =
          await fetch(
            `${API_URL}/upload-chunk`,
            {
              method: "POST",
              body: formData
            }
          );


        if (!response.ok) {

          let message =
            "Chunk upload failed";

          try {

            const data =
              await response.json();

            if (
              typeof data.detail ===
              "string"
            ) {

              message =
                data.detail;

            } else if (
              data.detail?.message
            ) {

              message =
                data.detail.message;

            }

          } catch {

            // Ignore JSON parsing error

          }


          throw new Error(
            message
          );

        }


        return await response.json();


      } catch (error) {

        console.error(
          `Chunk ${chunkIndex} failed.`,
          {
            attempt,
            error: error.message,
            transferId,
            fileIndex,
            chunkIndex,
            chunkSizeMB:
              (
                chunk.size /
                1024 /
                1024
              ).toFixed(2)
          }
        );


        if (
          attempt === MAX_RETRIES
        ) {

          throw new Error(
            `Chunk ${chunkIndex} failed after ${MAX_RETRIES} attempts: ${error.message}`
          );

        }


        // Wait before retrying
        const delay =
          1000 * attempt;


        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              delay
            )
        );

      }

    }

  };


  const uploadFile = async (
  transferId,
  file,
  fileIndex,
  startUploaded,
  totalBytes
) => {

  const totalChunks =
    Math.ceil(
      file.size / CHUNK_SIZE
    );


  // -------------------------------------------------
  // Ask server which chunks already exist
  // -------------------------------------------------

  const uploadedResponse =
    await fetch(
      `${API_URL}/uploaded-chunks/${transferId}/${fileIndex}`
    );


  let uploadedChunks = [];


  if (uploadedResponse.ok) {

    const uploadedData =
      await uploadedResponse.json();

    uploadedChunks =
      uploadedData.uploaded_chunks || [];

  }


  const uploadedSet =
    new Set(uploadedChunks);


  // -------------------------------------------------
  // Bytes already uploaded for this file
  // -------------------------------------------------

  let completedBytes = 0;


  for (
    const chunkIndex of uploadedSet
  ) {

    const start =
      chunkIndex * CHUNK_SIZE;

    const end =
      Math.min(
        start + CHUNK_SIZE,
        file.size
      );

    completedBytes +=
      end - start;

  }


  // -------------------------------------------------
  // Update progress for existing chunks
  // -------------------------------------------------

  const totalUploadedBefore =
    startUploaded + completedBytes;

  const totalProgressBefore =
    (
      totalUploadedBefore /
      totalBytes
    ) * 100;

  setProgress(
    Math.min(
      totalProgressBefore,
      100
    )
  );


  // -------------------------------------------------
  // Find pending chunks
  // -------------------------------------------------

  const pendingChunks = [];


  for (
    let i = 0;
    i < totalChunks;
    i++
  ) {

    if (
      !uploadedSet.has(i)
    ) {

      pendingChunks.push(i);

    }

  }


  // -------------------------------------------------
  // Upload chunks
  // -------------------------------------------------

  let nextIndex = 0;


  const worker = async () => {

    while (
      nextIndex <
      pendingChunks.length
    ) {

      const currentPosition =
        nextIndex++;

      const chunkIndex =
        pendingChunks[
          currentPosition
        ];


      const start =
        chunkIndex *
        CHUNK_SIZE;


      const end =
        Math.min(
          start + CHUNK_SIZE,
          file.size
        );


      const chunk =
        file.slice(
          start,
          end
        );


      // Upload
      await uploadChunk(
        transferId,
        fileIndex,
        chunkIndex,
        chunk
      );


      // Add uploaded bytes
      completedBytes +=
        chunk.size;


      // Calculate total uploaded
      const totalUploaded =
        startUploaded +
        completedBytes;


      // Calculate progress
      const totalProgress =
        (
          totalUploaded /
          totalBytes
        ) * 100;


      setProgress(
        Math.min(
          totalProgress,
          100
        )
      );

    }

  };


  // -------------------------------------------------
  // Create workers
  // -------------------------------------------------

  const workers = [];


  const workerCount =
    Math.min(
      MAX_PARALLEL_UPLOADS,
      pendingChunks.length
    );


  for (
    let i = 0;
    i < workerCount;
    i++
  ) {

    workers.push(
      worker()
    );

  }


  await Promise.all(
    workers
  );

};

  // ===================================================
  // CREATE TRANSFER
  // ===================================================

  const createTransfer = async () => {

    if (
      files.length === 0
    ) {

      alert(
        "Please select at least one file."
      );

      return;

    }


    if (
      !password.trim()
    ) {

      alert(
        "Please create a password."
      );

      return;

    }


    try {

      setLoading(true);

      setProgress(0);

      setSpeed(0);

      setShareLink("");


      // -----------------------------------------------
      // File information
      // -----------------------------------------------

      const filesInfo =
        files.map(
          (file) => ({

            name:
              file.name,

            size:
              file.size,

            total_chunks:
              Math.ceil(
                file.size /
                CHUNK_SIZE
              )

          })
        );


      // -----------------------------------------------
      // Initialize transfer
      // -----------------------------------------------

      const initData =
        new FormData();


      initData.append(
        "password",
        password
      );


      initData.append(
        "files_info",
        JSON.stringify(
          filesInfo
        )
      );


      const initResponse =
        await fetch(
          `${API_URL}/init-transfer`,
          {
            method: "POST",
            body: initData
          }
        );


      if (
        !initResponse.ok
      ) {

        const data =
          await initResponse.json();


        throw new Error(
          data.detail ||
          "Could not initialize transfer"
        );

      }


      const initResult =
        await initResponse.json();


      const transferId =
        initResult.transfer_id;


      // -----------------------------------------------
      // Total file size
      // -----------------------------------------------

      const totalBytes =
        files.reduce(
          (
            total,
            file
          ) =>
            total +
            file.size,
          0
        );


      let uploadedBefore = 0;


      const startTime =
        Date.now();


      // -----------------------------------------------
      // Upload every file
      // -----------------------------------------------

      for (
        let i = 0;
        i < files.length;
        i++
      ) {

        const file =
          files[i];


        await uploadFile(
          transferId,
          file,
          i,
          uploadedBefore,
          totalBytes
        );


        // Move to next file
        uploadedBefore +=
          file.size;


        setProgress(
          (
            uploadedBefore /
            totalBytes
          ) * 100
        );

      }


      // -----------------------------------------------
      // Complete transfer
      // -----------------------------------------------

      const completeData =
        new FormData();


      completeData.append(
        "transfer_id",
        transferId
      );


      const completeResponse =
        await fetch(
          `${API_URL}/complete-transfer`,
          {
            method: "POST",
            body: completeData
          }
        );


      if (
        !completeResponse.ok
      ) {

        const data =
          await completeResponse.json();


        let message =
          "Could not create transfer";


        if (
          typeof data.detail ===
          "string"
        ) {

          message =
            data.detail;

        } else if (
          data.detail?.message
        ) {

          message =
            data.detail.message;


          if (
            data.detail.missing_chunks?.length
          ) {

            message +=
              ` | Missing chunks: ${
                data.detail.missing_chunks.join(
                  ", "
                )
              }`;

          }

        }


        throw new Error(
          message
        );

      }


      const result =
        await completeResponse.json();


      // -----------------------------------------------
      // Share link
      // -----------------------------------------------

      setShareLink(
        result.share_link
      );


      setProgress(100);


      // -----------------------------------------------
      // Upload speed
      // -----------------------------------------------

      const seconds =
        (
          Date.now() -
          startTime
        ) / 1000;


      if (
        seconds > 0
      ) {

        setSpeed(
          totalBytes /
          seconds /
          1024 /
          1024
        );

      }


    } catch (error) {

      console.error(error);


      alert(
        error?.message ||
        String(error) ||
        "Upload failed"
      );


    } finally {

      setLoading(false);

    }

  };


  // ===================================================
  // SENDER UI
  // ===================================================

  return (

    <div className="page">

      <div className="card">

        <div className="logo-area">

          <h1>
            Sharing Data
          </h1>

          <p>
            Secure • Fast • Large File Sharing
          </p>

        </div>


        {/* Upload box */}

        <div className="upload-box">

          <div className="upload-icon">
            ↑
          </div>


          <h2>
            Upload your files
          </h2>


          <p className="upload-text">
            Select one or multiple files
            to share securely
          </p>


          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFiles}
            className="hidden-input"
          />


          <button
            type="button"
            className="choose-btn"
            onClick={
              handleChooseFiles
            }
          >
            Choose Files
          </button>


          <p className="supported-text">
            Large files supported
          </p>

        </div>


        {/* Files */}

        {files.length > 0 && (

          <div className="file-section">

            <div className="section-title">

              Selected Files (
              {files.length}
              )

            </div>


            <div className="file-list">

              {files.map(
                (
                  file,
                  index
                ) => (

                  <div
                    className="file-item"
                    key={index}
                  >

                    <div className="file-info">

                      <div className="file-icon">
                        📄
                      </div>


                      <div>

                        <div className="file-name">
                          {file.name}
                        </div>


                        <div className="file-size">

                          {(
                            file.size /
                            1024 /
                            1024
                          ).toFixed(2)}

                          {" MB"}

                        </div>

                      </div>

                    </div>

                  </div>

                )
              )}

            </div>

          </div>

        )}


        {/* Password */}

        <div className="password-section">

          <label>
            Create Password
          </label>


          <input
            type="password"
            placeholder="Enter a secure password"
            value={password}
            onChange={
              (event) =>
                setPassword(
                  event.target.value
                )
            }
          />


          <p className="password-help">
            The receiver will need this password.
          </p>

        </div>


        {/* Information */}

        <div className="info-box">

          <div className="info-item">

            <span>
              Link Validity
            </span>

            <strong>
              3 Hours
            </strong>

          </div>


          <div className="info-item">

            <span>
              Maximum Receivers
            </span>

            <strong>
              3
            </strong>

          </div>


          <div className="info-item">

            <span>
              Maximum Downloads
            </span>

            <strong>
              3
            </strong>

          </div>

        </div>


        {/* Progress */}

        {loading && (

          <div
            style={{
              marginTop: "20px"
            }}
          >

            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                marginBottom: "8px"
              }}
            >

              <span>
                Uploading...
              </span>


              <strong>
                {progress.toFixed(1)}%
              </strong>

            </div>


            <div
              style={{
                width: "100%",
                height: "10px",
                background:
                  "#e5e7eb",
                borderRadius: "10px",
                overflow: "hidden"
              }}
            >

              <div
                style={{
                  width:
                    `${progress}%`,
                  height: "100%",
                  background:
                    "#2563eb",
                  transition:
                    "width 0.2s"
                }}
              />

            </div>


            <p
              style={{
                textAlign: "center",
                marginTop: "8px"
              }}
            >

              10 MB chunks •{" "}
              {MAX_PARALLEL_UPLOADS}
              {" "}parallel uploads

            </p>


            {speed > 0 && (

              <p
                style={{
                  textAlign: "center",
                  marginTop: "5px"
                }}
              >

                Average speed:
                {" "}
                {speed.toFixed(2)}
                {" MB/s"}

              </p>

            )}

          </div>

        )}


        {/* Create */}

        <button
          className="create-btn"
          onClick={
            createTransfer
          }
          disabled={loading}
        >

          {loading
            ? "Uploading..."
            : "Create Secure Link"}

        </button>


        {/* Share result */}

        {shareLink && (

          <div className="share-result">

            <div className="success-icon">
              ✓
            </div>


            <h3>
              Transfer Created Successfully
            </h3>


            <p>
              Share this link with the receiver.
            </p>


            <div className="share-link-container">

              <a
                href={shareLink}
                className="share-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                🔗 {shareLink}
              </a>


              <div className="share-buttons">

                <button
                  className="copy-btn"
                  onClick={
                    async () => {

                      await navigator
                        .clipboard
                        .writeText(
                          shareLink
                        );


                      alert(
                        "Link copied!"
                      );

                    }
                  }
                >
                  Copy Link
                </button>


                <button
                  className="share-btn"
                  onClick={
                    async () => {

                      if (
                        navigator.share
                      ) {

                        await navigator.share({

                          title:
                            "Sharing Data",

                          text:
                            "I shared files with you.",

                          url:
                            shareLink

                        });

                      } else {

                        await navigator
                          .clipboard
                          .writeText(
                            shareLink
                          );


                        alert(
                          "Link copied!"
                        );

                      }

                    }
                  }
                >
                  Share
                </button>

              </div>

            </div>

          </div>

        )}

      </div>

    </div>

  );

}


// =====================================================
// RECEIVER
// =====================================================

function ReceiverPage() {

  const transferId =
    window.location.pathname
      .split("/")[2];


  const [password, setPassword] =
    useState("");


  const [files, setFiles] =
    useState([]);


  const [loading, setLoading] =
    useState(false);


  const [unlocked, setUnlocked] =
    useState(false);


  const [error, setError] =
    useState("");


  const [
    remainingDownloads,
    setRemainingDownloads
  ] = useState(3);


  // ---------------------------------------------------
  // Verify password
  // ---------------------------------------------------

  const verifyPassword = async () => {

    if (
      !password.trim()
    ) {

      setError(
        "Please enter the password."
      );

      return;

    }


    try {

      setLoading(true);

      setError("");


      const formData =
        new FormData();


      formData.append(
        "transfer_id",
        transferId
      );


      formData.append(
        "password",
        password
      );


      const response =
        await fetch(
          `${API_URL}/verify-transfer`,
          {
            method: "POST",
            body: formData
          }
        );


      const data =
        await response.json();


      if (
        !response.ok
      ) {

        throw new Error(
          data.detail ||
          "Unable to unlock transfer"
        );

      }


      setFiles(
        data.files
      );


      setRemainingDownloads(
        data.remaining_downloads
      );


      setUnlocked(true);


    } catch (error) {

      console.error(error);


      setError(
        error.message
      );


    } finally {

      setLoading(false);

    }

  };


  // ---------------------------------------------------
  // Download
  // ---------------------------------------------------

  const downloadFile = (
    filename
  ) => {

    if (
      remainingDownloads <= 0
    ) {

      alert(
        "Download limit reached."
      );

      return;

    }


    const downloadUrl =
      `${API_URL}/download/${transferId}/${encodeURIComponent(filename)}`;


    window.open(
      downloadUrl,
      "_blank"
    );


    setRemainingDownloads(
      remainingDownloads - 1
    );

  };


  // ===================================================
  // DASHBOARD
  // ===================================================

  if (unlocked) {

    return (

      <div className="page">

        <div className="card receiver-card">

          <div className="logo-area">

            <h1>
              Sharing Data
            </h1>

            <p>
              Your Secure Files
            </p>

          </div>


          <div className="receiver-success">

            <div className="success-icon">
              ✓
            </div>


            <h2>
              Access Granted
            </h2>


            <p>
              You can now select
              the files you need.
            </p>

          </div>


          <div className="dashboard-header">

            <div>

              <h3>
                Available Files
              </h3>

              <p>
                {files.length} file(s)
              </p>

            </div>


            <div className="download-count">

              Downloads left:

              <strong>
                {remainingDownloads}
              </strong>

            </div>

          </div>


          <div className="receiver-file-list">

            {files.map(
              (
                file,
                index
              ) => (

                <div
                  className="receiver-file"
                  key={index}
                >

                  <div className="receiver-file-info">

                    <div className="file-icon">
                      📄
                    </div>


                    <div>

                      <div className="file-name">
                        {file.name}
                      </div>


                      <div className="file-size">

                        {(
                          file.size /
                          1024 /
                          1024
                        ).toFixed(2)}

                        {" MB"}

                      </div>

                    </div>

                  </div>


                  <button
                    className="download-btn"
                    onClick={
                      () =>
                        downloadFile(
                          file.name
                        )
                    }
                    disabled={
                      remainingDownloads <= 0
                    }
                  >
                    Download
                  </button>

                </div>

              )
            )}

          </div>

        </div>

      </div>

    );

  }


  // ===================================================
  // PASSWORD PAGE
  // ===================================================

  return (

    <div className="page">

      <div className="card receiver-card">

        <div className="logo-area">

          <h1>
            Sharing Data
          </h1>

          <p>
            Secure File Transfer
          </p>

        </div>


        <div className="lock-icon">
          🔐
        </div>


        <h2 className="receiver-title">
          Password Required
        </h2>


        <p className="receiver-description">

          This file transfer is protected
          by a password.

          Enter the password provided
          by the sender.

        </p>


        <div className="password-section">

          <label>
            Transfer Password
          </label>


          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={
              (event) =>
                setPassword(
                  event.target.value
                )
            }
            onKeyDown={
              (event) => {

                if (
                  event.key === "Enter"
                ) {

                  verifyPassword();

                }

              }
            }
          />

        </div>


        {error && (

          <div className="error-message">
            {error}
          </div>

        )}


        <button
          className="create-btn"
          onClick={
            verifyPassword
          }
          disabled={loading}
        >

          {loading
            ? "Verifying..."
            : "Unlock Files"}

        </button>


        <div className="receiver-info">

          🔒 Password protected

          <br />

          ⏱ Link valid for 3 hours

          <br />

          📥 Maximum 3 downloads

        </div>

      </div>

    </div>

  );

}


// =====================================================
// APP
// =====================================================

function App() {

  const path =
    window.location.pathname;


  if (
    path.startsWith(
      "/transfer/"
    )
  ) {

    return (
      <ReceiverPage />
    );

  }


  return (
    <SenderPage />
  );

}


export default App;