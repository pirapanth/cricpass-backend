const { sendContactUsEmail } = require('../services/emailService');

/**
 * @desc    Submit user issue / inquiry with optional attachment and email to Master Admin
 * @route   POST /api/contact/submit
 * @access  Public
 */
async function submitContactReport(req, res, next) {
  try {
    const rawUserEmail = req.body.user_email || req.body.email;
    const user_email =
      rawUserEmail && typeof rawUserEmail === 'string' && rawUserEmail.trim()
        ? rawUserEmail.trim()
        : 'cricpassadmin@gmail.com';
    const subject = req.body.subject;
    const issueDescription =
      req.body.issue_description ||
      req.body.description ||
      req.body.issueDescription ||
      req.body.message;
    const attachment = req.body.attachment;

    // Optional email validation if provided
    if (user_email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(user_email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email address format'
        });
      }
    }

    if (!issueDescription || !issueDescription.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Issue description is required'
      });
    }

    // Process attachment if provided (validate size under 5MB)
    let processedAttachment = null;
    if (attachment && attachment.content) {
      if (attachment.size && attachment.size > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: 'Attachment exceeds maximum size of 5MB'
        });
      }

      processedAttachment = {
        filename: attachment.filename || 'attachment',
        content: attachment.content.replace(/^data:[^;]+;base64,/, ''),
        encoding: 'base64',
        contentType: attachment.contentType || 'application/octet-stream'
      };
    }

    await sendContactUsEmail({
      userEmail: user_email.trim(),
      subject: subject ? subject.trim() : 'General Inquiry / Support Request',
      issueDescription: issueDescription.trim(),
      attachment: processedAttachment
    });

    return res.status(200).json({
      success: true,
      message: 'Your issue was successfully reported! Our support team has been notified.'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  submitContactReport
};
