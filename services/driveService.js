const { drive, auth } = require('@googleapis/drive');
const { Readable } = require('stream');

function getDriveClient() {
  const oauth2Client = new auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return drive({ version: 'v3', auth: oauth2Client });
}

async function uploadFileToDrive(fileBuffer, mimeType, fileName) {
  const driveClient = getDriveClient();

  const fileMetadata = {
    name: fileName,
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
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
  await driveClient.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId: fileId,
    viewUrl: response.data.webViewLink,
    downloadUrl: response.data.webContentLink,
  };
}

module.exports = { uploadFileToDrive };