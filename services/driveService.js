const { drive, auth } = require('@googleapis/drive');
const { Readable } = require('stream');

function getDriveClient() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  const googleAuth = new auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return drive({ version: 'v3', auth: googleAuth });
}

/**
 * Uploads an in-memory buffer to Google Drive and sets public read permissions.
 * Returns { fileId, viewUrl, downloadUrl }
 */
async function uploadFileToDrive(buffer, mimeType, fileName) {
  // If drive credentials are not configured, fallback gracefully for local development/testing
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.warn('⚠️ [Drive Service] Google Drive credentials not set in .env. Returning simulated view URL.');
    const mockFileId = `drive_mock_${Date.now()}`;
    return {
      fileId: mockFileId,
      viewUrl: `https://drive.google.com/file/d/${mockFileId}/view`,
      downloadUrl: `https://drive.google.com/uc?id=${mockFileId}&export=download`
    };
  }

  const driveClient = getDriveClient();
  const readableStream = new Readable();
  readableStream.push(buffer);
  readableStream.push(null);

  const fileMetadata = {
    name: fileName,
  };

  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    fileMetadata.parents = [process.env.GOOGLE_DRIVE_FOLDER_ID];
  }

  const media = {
    mimeType: mimeType,
    body: readableStream,
  };

  const response = await driveClient.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink, webContentLink',
  });

  const fileId = response.data.id;

  // Make the file viewable by anyone with the link
  try {
    await driveClient.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  } catch (permErr) {
    console.warn('⚠️ Could not set public permission on Drive file:', permErr.message);
  }

  return {
    fileId: fileId,
    viewUrl: response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    downloadUrl: response.data.webContentLink || `https://drive.google.com/uc?id=${fileId}&export=download`,
  };
}

module.exports = {
  getDriveClient,
  uploadFileToDrive,
};
