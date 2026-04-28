function doGet() {
  return jsonResponse({
    ok: true,
    message: 'Google Drive upload endpoint is running.',
  })
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        ok: false,
        message: 'Missing request body.',
      })
    }

    const payload = JSON.parse(e.postData.contents)
    const folderId = String(payload.folderId || '').trim()
    const fileName = String(payload.fileName || '').trim()
    const mimeType = String(payload.mimeType || 'application/octet-stream').trim()
    const contentBase64 = String(payload.contentBase64 || '').trim()

    if (!folderId) {
      return jsonResponse({
        ok: false,
        message: 'folderId is required.',
      })
    }

    if (!fileName) {
      return jsonResponse({
        ok: false,
        message: 'fileName is required.',
      })
    }

    if (!contentBase64) {
      return jsonResponse({
        ok: false,
        message: 'contentBase64 is required.',
      })
    }

    const folder = DriveApp.getFolderById(folderId)
    const bytes = Utilities.base64Decode(contentBase64)
    const blob = Utilities.newBlob(bytes, mimeType, fileName)
    const file = folder.createFile(blob)

    return jsonResponse({
      ok: true,
      fileId: file.getId(),
      fileName: file.getName(),
      fileUrl: file.getUrl(),
    })
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error && error.message ? error.message : 'Unexpected upload error.',
    })
  }
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
