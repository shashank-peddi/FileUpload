import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import './App.css'
import {
  extractGoogleDriveFolderId,
  formatFileSize,
  isImageFile,
  MAX_FILE_SIZE_BYTES,
  uploadPhoto,
} from './lib/googleDrive'

type UploadStatus = 'ready' | 'uploading' | 'uploaded' | 'failed'
type BannerTone = 'info' | 'success' | 'warning' | 'error'

type Banner = {
  tone: BannerTone
  text: string
}

type PhotoItem = {
  id: string
  file: File
  previewUrl: string
  status: UploadStatus
  error: string | null
  driveUrl: string | null
}

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024)

const statusLabels: Record<UploadStatus, string> = {
  ready: 'Ready',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  failed: 'Failed',
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photosRef = useRef<PhotoItem[]>([])
  const uploadEndpoint = String(import.meta.env.VITE_UPLOAD_ENDPOINT ?? '').trim()
  const configuredFolderLink = String(import.meta.env.VITE_DRIVE_FOLDER_LINK ?? '').trim()
  const configuredFolderName =
    String(import.meta.env.VITE_DRIVE_FOLDER_NAME ?? '').trim() || 'Shared Google Drive folder'
  const folderId = useMemo(
    () => extractGoogleDriveFolderId(configuredFolderLink),
    [configuredFolderLink],
  )
  const hasUploadEndpoint = uploadEndpoint.length > 0
  const hasDriveFolder = Boolean(folderId)
  const configurationHint = !hasUploadEndpoint && !hasDriveFolder
    ? 'Set both VITE_UPLOAD_ENDPOINT and VITE_DRIVE_FOLDER_LINK in your deployment or local environment to enable uploads.'
    : !hasUploadEndpoint
      ? 'Set VITE_UPLOAD_ENDPOINT in your deployment or local environment to enable uploads.'
      : !hasDriveFolder
        ? 'Set VITE_DRIVE_FOLDER_LINK in your deployment or local environment to a valid Google Drive folder link or folder ID.'
        : `Ready to upload to ${configuredFolderName}.`
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [banner, setBanner] = useState<Banner>(() => {
    if (!hasUploadEndpoint && !hasDriveFolder) {
      return {
        tone: 'warning',
        text: 'Set VITE_UPLOAD_ENDPOINT and VITE_DRIVE_FOLDER_LINK in your deployment or local environment before trying to upload.',
      }
    }

    if (!hasUploadEndpoint) {
      return {
        tone: 'warning',
        text: 'Set VITE_UPLOAD_ENDPOINT in your deployment or local environment before trying to upload.',
      }
    }

    if (!hasDriveFolder) {
      return {
        tone: 'warning',
        text: 'Set VITE_DRIVE_FOLDER_LINK to a valid Google Drive folder before trying to upload.',
      }
    }

    return {
      tone: 'info',
      text: `Select photos and upload them to ${configuredFolderName}.`,
    }
  })
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const uploadedCount = photos.filter((photo) => photo.status === 'uploaded').length
  const failedCount = photos.filter((photo) => photo.status === 'failed').length
  const pendingCount = photos.filter((photo) => photo.status !== 'uploaded').length
  const uploadButtonLabel = isUploading
    ? 'Uploading...'
    : pendingCount > 0
      ? `Upload ${pendingCount} photo${pendingCount === 1 ? '' : 's'}`
      : 'Upload photos'

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => {
    return () => {
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
    }
  }, [])

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    )
  }

  const addPhotos = (incoming: FileList | File[]) => {
    const files = Array.from(incoming)

    if (files.length === 0) {
      return
    }

    const existingIds = new Set(photos.map((photo) => photo.id))
    const additions: PhotoItem[] = []
    let rejectedCount = 0
    let oversizedCount = 0
    let duplicateCount = 0

    for (const file of files) {
      const id = `${file.name}-${file.size}-${file.lastModified}`

      if (!isImageFile(file)) {
        rejectedCount += 1
        continue
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        oversizedCount += 1
        continue
      }

      if (existingIds.has(id)) {
        duplicateCount += 1
        continue
      }

      existingIds.add(id)
      additions.push({
        id,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'ready',
        error: null,
        driveUrl: null,
      })
    }

    if (additions.length > 0) {
      setPhotos((current) => [...current, ...additions])
    }

    const messages: string[] = []

    if (additions.length > 0) {
      messages.push(`${additions.length} photo${additions.length === 1 ? '' : 's'} ready to upload.`)
    }

    if (duplicateCount > 0) {
      messages.push(
        `${duplicateCount} duplicate photo${duplicateCount === 1 ? ' was' : 's were'} skipped.`,
      )
    }

    if (rejectedCount > 0) {
      messages.push(
        `${rejectedCount} non-image file${rejectedCount === 1 ? ' was' : 's were'} ignored.`,
      )
    }

    if (oversizedCount > 0) {
      messages.push(
        `${oversizedCount} file${oversizedCount === 1 ? '' : 's'} exceeded ${MAX_FILE_SIZE_MB} MB.`,
      )
    }

    if (messages.length > 0) {
      setBanner({
        tone: rejectedCount > 0 || oversizedCount > 0 ? 'warning' : 'info',
        text: messages.join(' '),
      })
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return
    }

    addPhotos(event.target.files)
    event.target.value = ''
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)

    if (event.dataTransfer.files.length > 0) {
      addPhotos(event.dataTransfer.files)
    }
  }

  const removePhoto = (id: string) => {
    setPhotos((current) => {
      const photoToRemove = current.find((photo) => photo.id === id)

      if (photoToRemove) {
        URL.revokeObjectURL(photoToRemove.previewUrl)
      }

      return current.filter((photo) => photo.id !== id)
    })
  }

  const clearPhotos = () => {
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
      return []
    })

    setBanner({
      tone: 'info',
      text: 'Photo list cleared. Add more photos whenever you are ready.',
    })
  }

  const handleUpload = async () => {
    if (photos.length === 0) {
      setBanner({
        tone: 'warning',
        text: 'Choose at least one photo before uploading.',
      })
      return
    }

    const queuedPhotos = photos.filter((photo) => photo.status !== 'uploaded')

    if (queuedPhotos.length === 0) {
      setBanner({
        tone: 'info',
        text: 'All selected photos have already been uploaded.',
      })
      return
    }

    if (!uploadEndpoint) {
      setBanner({
        tone: 'error',
        text: 'Set VITE_UPLOAD_ENDPOINT in your deployment or local environment before trying to upload.',
      })
      return
    }

    if (!folderId) {
      setBanner({
        tone: 'error',
        text: 'Set VITE_DRIVE_FOLDER_LINK to a valid Google Drive folder link or folder ID before uploading.',
      })
      return
    }

    setIsUploading(true)
    setBanner({
      tone: 'info',
      text: `Uploading ${queuedPhotos.length} photo${queuedPhotos.length === 1 ? '' : 's'} to Google Drive...`,
    })

    let successfulUploads = 0
    let failedUploads = 0
    let firstErrorMessage: string | null = null

    for (const photo of queuedPhotos) {
      updatePhoto(photo.id, { status: 'uploading', error: null })

      try {
        const result = await uploadPhoto({
          endpoint: uploadEndpoint,
          folderId,
          file: photo.file,
        })

        updatePhoto(photo.id, {
          status: 'uploaded',
          driveUrl: result.fileUrl || null,
          error: null,
        })
        successfulUploads += 1
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'The photo could not be uploaded.'

        updatePhoto(photo.id, {
          status: 'failed',
          driveUrl: null,
          error: errorMessage,
        })
        firstErrorMessage ??= errorMessage
        failedUploads += 1
      }
    }

    setIsUploading(false)

    if (failedUploads === 0) {
      setBanner({
        tone: 'success',
        text: `Uploaded ${successfulUploads} photo${successfulUploads === 1 ? '' : 's'} to Google Drive.`,
      })
      return
    }

    if (successfulUploads === 0) {
      setBanner({
        tone: 'error',
        text: `Upload failed for ${failedUploads} photo${failedUploads === 1 ? '' : 's'}. ${firstErrorMessage ?? 'Check the endpoint setup and try again.'}`,
      })
      return
    }

    setBanner({
      tone: 'warning',
      text: `Uploaded ${successfulUploads} photo${successfulUploads === 1 ? '' : 's'}, but ${failedUploads} failed. ${firstErrorMessage ?? 'You can retry the failed uploads.'}`,
    })
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Photo Drive Uploader</p>
          <h1>Collect photos and send them to a shared Google Drive folder.</h1>
          <p className="lead">
            This React project is ready for GitHub hosting. Users can add photos on a
            single page, while uploads are sent through a configurable endpoint so Drive
            credentials stay out of the browser.
          </p>
        </div>

        <div className="hero-badges">
          <span className={`pill ${uploadEndpoint ? 'pill-success' : 'pill-warning'}`}>
            {uploadEndpoint ? 'Upload endpoint configured' : 'Upload endpoint needed'}
          </span>
          <span className={`pill ${folderId ? 'pill-success' : 'pill-neutral'}`}>
            {folderId ? 'Drive folder ready' : 'Drive folder needed'}
          </span>
        </div>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="section-heading">
            <div>
              <h2>Drive destination</h2>
              <p>The upload page is locked to your configured shared Google Drive folder.</p>
            </div>
          </div>

          <div className="destination-card">
            <div className="destination-copy">
              <p className="destination-label">Configured shared folder</p>
              <h3 className="destination-name">{configuredFolderName}</h3>
              {configuredFolderLink ? (
                <a
                  className="text-link destination-link"
                  href={configuredFolderLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  {configuredFolderLink}
                </a>
              ) : (
                <p className="muted-text">
                  Set <code>VITE_DRIVE_FOLDER_LINK</code> in your deployment or local environment.
                </p>
              )}
              <p className={`helper destination-id ${folderId ? 'helper-success' : ''}`}>
                {folderId
                  ? `Configured folder ID: ${folderId}`
                  : 'Set VITE_DRIVE_FOLDER_LINK to a valid Google Drive folder link or ID.'}
              </p>
            </div>
          </div>

          <div className={`banner banner-${banner.tone}`}>
            <p>{banner.text}</p>
          </div>

          <div
            className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="presentation"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFileChange}
            />
            <p className="dropzone-title">Drag and drop photos here</p>
            <p className="dropzone-copy">or choose images from your device</p>
            <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>
              Choose photos
            </button>
            <p className="dropzone-meta">
              Image files only, up to {MAX_FILE_SIZE_MB} MB each.
            </p>
          </div>

          <div className="action-row">
            <div className="stats">
              <span>{photos.length} selected</span>
              <span>{uploadedCount} uploaded</span>
              {failedCount > 0 && <span>{failedCount} failed</span>}
            </div>

            <div className="button-row">
              <button
                type="button"
                className="ghost-button"
                onClick={clearPhotos}
                disabled={photos.length === 0 || isUploading}
              >
                Clear photos
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleUpload}
                disabled={isUploading}
              >
                {uploadButtonLabel}
              </button>
            </div>
          </div>

          <p className={`config-note ${hasUploadEndpoint && hasDriveFolder ? 'config-note-success' : ''}`}>
            {configurationHint}
          </p>
        </div>

        <aside className="panel side-panel">
          <div>
            <h2>Setup checklist</h2>
            <ol className="checklist">
              <li>Deploy the sample `apps-script/Code.gs` file as a Google Apps Script web app.</li>
              <li>Set `VITE_UPLOAD_ENDPOINT` in your GitHub environment variables or `.env.local` for local testing.</li>
              <li>Set `VITE_DRIVE_FOLDER_LINK` in your GitHub environment variables or `.env.local` for local testing.</li>
              <li>Start uploading photos.</li>
            </ol>
          </div>

          <div className="endpoint-card">
            <h3>Current endpoint</h3>
            <code>{uploadEndpoint || 'VITE_UPLOAD_ENDPOINT is not set yet.'}</code>
          </div>

          <p className="side-note">
            If you want OneDrive, Dropbox, SharePoint, or another storage provider, the
            upload endpoint can be swapped without redesigning the page.
          </p>
        </aside>
      </section>

      <section className="gallery-panel">
        <div className="section-heading">
          <div>
            <h2>Selected photos</h2>
            <p>Upload one or many images in the same session and retry any failures.</p>
          </div>
        </div>

        {photos.length === 0 ? (
          <div className="empty-state">
            <p>No photos selected yet.</p>
          </div>
        ) : (
          <ul className="photo-grid">
            {photos.map((photo) => (
              <li key={photo.id} className="photo-card">
                <div className="photo-preview-wrap">
                  <img
                    className="photo-preview"
                    src={photo.previewUrl}
                    alt={photo.file.name}
                  />
                  <span className={`status-badge status-${photo.status}`}>
                    {statusLabels[photo.status]}
                  </span>
                </div>

                <div className="photo-card-body">
                  <div className="photo-meta">
                    <h3>{photo.file.name}</h3>
                    <p>{formatFileSize(photo.file.size)}</p>
                  </div>

                  {photo.error && <p className="photo-error">{photo.error}</p>}

                  <div className="photo-actions">
                    {photo.driveUrl ? (
                      <a
                        className="text-link"
                        href={photo.driveUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Drive
                      </a>
                    ) : (
                      <span className="muted-text">
                        {isUploading && photo.status === 'uploading'
                          ? 'Uploading now...'
                          : 'Drive link will appear after upload'}
                      </span>
                    )}

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => removePhoto(photo.id)}
                      disabled={isUploading && photo.status === 'uploading'}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
