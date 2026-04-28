import { useMemo, useRef, useState } from 'react'
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
  status: UploadStatus
  error: string | null
}

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024)
const MAX_PARALLEL_UPLOADS = 5

const statusLabels: Record<UploadStatus, string> = {
  ready: 'Ready to upload',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  failed: 'Needs retry',
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadEndpoint = String(import.meta.env.VITE_UPLOAD_ENDPOINT ?? '').trim()
  const configuredFolderLink = String(import.meta.env.VITE_DRIVE_FOLDER_LINK ?? '').trim()
  const folderId = useMemo(
    () => extractGoogleDriveFolderId(configuredFolderLink),
    [configuredFolderLink],
  )
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const totalCount = photos.length
  const uploadedCount = photos.filter((photo) => photo.status === 'uploaded').length
  const uploadingCount = photos.filter((photo) => photo.status === 'uploading').length
  const failedCount = photos.filter((photo) => photo.status === 'failed').length
  const remainingCount = totalCount - uploadedCount
  const progressPercent =
    totalCount === 0 ? 0 : Math.round((uploadedCount / totalCount) * 100)
  const uploadButtonLabel = isUploading
    ? 'Uploading...'
    : remainingCount > 0
      ? `Upload remaining ${remainingCount}`
      : 'All uploaded'

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    )
  }

  const getUploadSetupError = () => {
    if (!uploadEndpoint && !folderId) {
      return 'Uploads are not configured yet. Please try again later.'
    }

    if (!uploadEndpoint) {
      return 'Upload service is not configured yet. Please try again later.'
    }

    if (!folderId) {
      return 'Upload destination is not configured yet. Please try again later.'
    }

    return null
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
        status: 'ready',
        error: null,
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

  const clearPhotos = () => {
    setPhotos([])
    setBanner({
      tone: 'info',
      text: 'Photo list cleared.',
    })
  }

  const uploadSinglePhoto = async (photo: PhotoItem) => {
    updatePhoto(photo.id, { status: 'uploading', error: null })

    try {
      await uploadPhoto({
        endpoint: uploadEndpoint,
        folderId: folderId ?? '',
        file: photo.file,
      })

      updatePhoto(photo.id, {
        status: 'uploaded',
        error: null,
      })
      return { success: true, errorMessage: null }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'The photo could not be uploaded.'

      updatePhoto(photo.id, {
        status: 'failed',
        error: errorMessage,
      })
      return { success: false, errorMessage }
    }
  }

  const runUploadBatch = async (targetPhotos: PhotoItem[], batchSize = MAX_PARALLEL_UPLOADS) => {
    const setupError = getUploadSetupError()

    if (setupError) {
      setBanner({
        tone: 'error',
        text: setupError,
      })
      return
    }

    const firstTargetName = targetPhotos[0]?.file.name ?? 'photo'
    const parallelUploads = Math.min(batchSize, targetPhotos.length)

    setIsUploading(true)
    setBanner({
      tone: 'info',
      text:
        targetPhotos.length === 1
          ? `Uploading ${firstTargetName}...`
          : `Uploading ${targetPhotos.length} photos (${parallelUploads} at a time)...`,
    })

    const results: Array<{ success: boolean; errorMessage: string | null }> = []

    for (let batchStart = 0; batchStart < targetPhotos.length; batchStart += parallelUploads) {
      const batch = targetPhotos.slice(batchStart, batchStart + parallelUploads)
      const batchResults = await Promise.all(batch.map(uploadSinglePhoto))
      results.push(...batchResults)
    }

    setIsUploading(false)

    const successfulUploads = results.filter((result) => result.success).length
    const failedUploads = results.length - successfulUploads
    const firstErrorMessage =
      results.find((result) => !result.success)?.errorMessage ?? null

    if (failedUploads === 0) {
      setBanner({
        tone: 'success',
        text:
          targetPhotos.length === 1
            ? `${firstTargetName} uploaded successfully.`
            : `Uploaded ${successfulUploads} photo${successfulUploads === 1 ? '' : 's'}.`,
      })
      return
    }

    if (successfulUploads === 0) {
      setBanner({
        tone: 'error',
        text:
          targetPhotos.length === 1
            ? `Could not upload ${firstTargetName}. ${firstErrorMessage ?? 'Please try again.'}`
            : `Upload failed for ${failedUploads} photo${failedUploads === 1 ? '' : 's'}. ${firstErrorMessage ?? 'Please try again.'}`,
      })
      return
    }

    setBanner({
      tone: 'warning',
      text: `Uploaded ${successfulUploads} photo${successfulUploads === 1 ? '' : 's'}. ${failedUploads} still need retry. ${firstErrorMessage ?? ''}`.trim(),
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

    await runUploadBatch(queuedPhotos)
  }

  const handleUploadSingle = async (photoId: string) => {
    const targetPhoto = photos.find((photo) => photo.id === photoId)

    if (!targetPhoto || targetPhoto.status === 'uploaded' || targetPhoto.status === 'uploading') {
      return
    }

    await runUploadBatch([targetPhoto], 1)
  }

  return (
    <main className="app-shell">
      <section className="upload-card">
        <div className="page-heading">
          <h1>Upload your photos</h1>
          <p>Select photos from your device and upload them to the shared album.</p>
        </div>

        {totalCount > 0 && (
          <div className="progress-overview">
            <div className="progress-copy">
              <p className="progress-label">Upload progress</p>
              <div className="progress-metrics">
                <span className="progress-value">{progressPercent}%</span>
                <span className="progress-subtext">
                  {uploadedCount} of {totalCount} uploaded
                </span>
              </div>
            </div>

            <div className="progress-bar" aria-hidden="true">
              <span
                className="progress-bar-fill"
                style={{ width: `${progressPercent}%` }}
              ></span>
            </div>

            <div className="progress-stats">
              <span>{uploadedCount} uploaded</span>
              <span>{remainingCount} remaining</span>
              {uploadingCount > 0 && <span>{uploadingCount} uploading</span>}
              {failedCount > 0 && <span>{failedCount} need retry</span>}
            </div>
          </div>
        )}

        {banner && (
          <div className={`banner banner-${banner.tone}`}>
            <p>{banner.text}</p>
          </div>
        )}

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
          <button
            type="button"
            className="primary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose photos
          </button>
          <p className="dropzone-meta">Image files only, up to {MAX_FILE_SIZE_MB} MB each.</p>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="ghost-button"
            onClick={clearPhotos}
            disabled={totalCount === 0 || isUploading}
          >
            Clear list
          </button>
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              onClick={handleUpload}
              disabled={isUploading || totalCount === 0 || remainingCount === 0}
            >
              {uploadButtonLabel}
            </button>
          </div>
        </div>
      </section>

        <section className="file-list-card">
          <div className="list-header">
            <div>
              <h2>Files</h2>
              <p>Uploaded files show a tick. Pending or failed files can be uploaded again.</p>
            </div>
            {totalCount > 0 && <span className="list-count">{totalCount} files</span>}
          </div>

          {photos.length === 0 ? (
          <div className="empty-state">
            <p>No photos added yet.</p>
          </div>
        ) : (
          <ul className="file-list">
            {photos.map((photo) => (
              <li key={photo.id} className={`file-row file-row-${photo.status}`}>
                <div className="file-row-main">
                  <span
                    className={`file-status-indicator file-status-${photo.status}`}
                    aria-hidden="true"
                  >
                    {photo.status === 'uploaded'
                      ? '✓'
                      : photo.status === 'failed'
                        ? '!'
                        : photo.status === 'uploading'
                          ? '...'
                          : '•'}
                  </span>

                  <div className="file-copy">
                    <p className="file-name">{photo.file.name}</p>
                    <p className="file-meta">
                      {formatFileSize(photo.file.size)} · {statusLabels[photo.status]}
                    </p>
                    {photo.error && <p className="file-error">{photo.error}</p>}
                  </div>
                </div>

                <div className="file-row-actions">
                  {photo.status === 'uploaded' ? (
                    <span className="file-result file-result-uploaded">
                      <span className="file-result-tick" aria-hidden="true">
                        ✓
                      </span>
                      Uploaded
                    </span>
                  ) : photo.status === 'uploading' ? (
                    <span className="file-result file-result-uploading">Uploading...</span>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void handleUploadSingle(photo.id)}
                      disabled={isUploading}
                    >
                      {photo.status === 'failed' ? 'Retry' : 'Upload'}
                    </button>
                  )}
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
