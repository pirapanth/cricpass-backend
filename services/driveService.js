const { drive, auth } = require('@googleapis/drive');
const { Readable } = require('stream');

let cachedDriveClient = null;

function getDriveClient() {
  if (cachedDriveClient) {
    return cachedDriveClient;
  }

  const oauth2Client = new auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  cachedDriveClient = drive({ version: 'v3', auth: oauth2Client });
  return cachedDriveClient;
}

async function uploadFileToDrive(fileBuffer, mimeType, fileName) {
  const driveClient = getDriveClient();

  const fileMetadata = {
    name: fileName,
    parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : [],
  };

  const media = {
    mimeType: mimeType,
    body: Readable.from(fileBuffer),
  };

  const response = await driveClient.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink, webContentLink',
  });

  const fileId = response.data.id;

  // Make file viewable via link
  try {
    await driveClient.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  } catch (permErr) {
    console.warn('⚠️ [Drive Service] Public permission warning:', permErr.message);
  }

  return {
    fileId: fileId,
    viewUrl: response.data.webViewLink,
    downloadUrl: response.data.webContentLink,
  };
}

module.exports = { uploadFileToDrive };
