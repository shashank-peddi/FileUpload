const MAX_FILE_SIZE_MB = 10

export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

type UploadPhotoInput = {
  endpoint: string
  folderId: string
  file: File
}

type UploadPhotoResponse = {
  ok?: boolean
  message?: string
  fileId?: string
  fileUrl?: string
}

export function extractGoogleDriveFolderId(value: string): string | null {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]{10,})$/,
  ]

  for (const pattern of patterns) {
    const match = trimmedValue.match(pattern)

    if (match) {
      return match[1]
    }
  }

  return null
}

export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|webp)$/i.test(file.name)
  )
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const decimals = value >= 10 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[unitIndex]}`
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result

      if (typeof result !== 'string') {
        reject(new Error('The selected file could not be read.'))
        return
      }

      const [, base64Content] = result.split(',')

      if (!base64Content) {
        reject(new Error('The selected file could not be encoded for upload.'))
        return
      }

      resolve(base64Content)
    }

    reader.onerror = () => {
      reject(new Error('The selected file could not be read.'))
    }

    reader.readAsDataURL(file)
  })
}

export async function uploadPhoto({
  endpoint,
  folderId,
  file,
}: UploadPhotoInput): Promise<{ fileId: string; fileUrl: string }> {
  const contentBase64 = await readFileAsBase64(file)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      folderId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      contentBase64,
    }),
  })

  const payload = (await response.json().catch(() => null)) as UploadPhotoResponse | null

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message ?? `Upload failed with status ${response.status}.`)
  }

  return {
    fileId: payload?.fileId ?? '',
    fileUrl: payload?.fileUrl ?? '',
  }
}
