require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { errorHandler } = require('./shared/error.handler');

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});

app.post('/api/email/welcome', async (req, res, next) => {
  try {
    const { email, role, companyName, companySlug, tempPassword, loginUrl } = req.body;
    
    console.log('Sending email to:', email);

    const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; margin: 0; padding: 20px; background-color: #f8fafc; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #2563eb, #1e40af); padding: 40px 20px; text-align: center; color: white; }
  .header h1 { margin: 0; font-size: 28px; }
  .header p { margin: 10px 0 0; font-size: 14px; opacity: 0.9; }
  .content { padding: 30px; }
  .info-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
  .info-row { margin-bottom: 12px; }
  .info-row:last-child { margin-bottom: 0; }
  .info-label { display: inline-block; width: 130px; font-weight: 700; color: #94a3b8; font-size: 12px; letter-spacing: 0.5px; }
  .info-value { color: #0f172a; font-size: 14px; font-weight: 500; }
  .info-value a { color: #2563eb; text-decoration: none; }
  .password-box { background-color: #0f172a; color: #38bdf8; text-align: center; font-size: 24px; font-family: monospace; letter-spacing: 2px; padding: 15px; border-radius: 8px; margin: 15px 0; font-weight: bold; }
  .warning-box { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 15px; color: #b45309; font-size: 13px; margin-bottom: 25px; }
  .btn-container { text-align: center; margin-top: 30px; }
  .btn { display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; }
  .footer { background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Welcome to DMS</h1>
      <p>Document Management System</p>
    </div>
    <div class="content">
      <h3 style="margin-top:0; color:#0f172a;">Hello!</h3>
      <p style="line-height: 1.6;">Your company <strong>${companyName}</strong> has been successfully registered on the DMS platform. You can now log in to your dedicated company portal using the credentials below.</p>
      
      <div class="info-box">
        <div class="info-row"><span class="info-label">COMPANY</span> <span class="info-value">${companyName}</span></div>
        <div class="info-row"><span class="info-label">YOUR EMAIL</span> <span class="info-value">${email}</span></div>
        <div class="info-row"><span class="info-label">PORTAL URL</span> <span class="info-value"><a href="${loginUrl}">${loginUrl}</a></span></div>
        <div class="info-row"><span class="info-label">TEMP PASSWORD</span> <span class="info-value">See below</span></div>
      </div>
      
      <p style="font-weight: 600; margin-bottom: 5px;">Your temporary password:</p>
      <div class="password-box">${tempPassword}</div>
      
      <div class="warning-box">
        ⚠️ <strong>Important:</strong> Please log in and change your password immediately. This temporary password will expire after first use.
      </div>
      
      <div class="btn-container">
        <a href="${loginUrl}" class="btn">Go to Your Portal &rarr;</a>
      </div>
    </div>
    <div class="footer">
      &copy; 2026 DMS &mdash; Document Management System.<br>This is an automated email, please do not reply.
    </div>
  </div>
</body>
</html>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.FROM_EMAIL,
      to: email,
      subject: 'Welcome to ' + companyName,
      html
    });

    res.status(200).json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Email send failed:', err);
    next(err);
  }
});

app.post('/api/email/reply', async (req, res, next) => {
  try {
    const { email, subject, message, replyFrom = "Aditya <aditya@netfotech.in>" } = req.body;
    
    console.log('Sending reply email to:', email);

    const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; margin: 0; padding: 20px; background-color: #f8fafc; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
  .header { background: #2563eb; padding: 25px 20px; color: white; }
  .header h1 { margin: 0; font-size: 20px; }
  .content { padding: 30px; white-space: pre-wrap; font-size: 15px; line-height: 1.6; }
  .footer { background-color: #f1f5f9; padding: 20px; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Reply to Your Enquiry</h1>
    </div>
    <div class="content">${message}</div>
    <div class="footer">
      <strong>Best regards,</strong><br>
      Aditya<br>
      netfotech.in
    </div>
  </div>
</body>
</html>
    `;

    await transporter.sendMail({
      from: replyFrom,
      replyTo: replyFrom,
      to: email,
      subject: subject || 'Reply to your enquiry',
      html
    });

    res.status(200).json({ success: true, message: 'Reply sent successfully' });
  } catch (err) {
    console.error('Reply email send failed:', err);
    next(err);
  }
});


app.post('/api/email/forgot-password', async (req, res, next) => {
  try {
    const { email, companyName, otp } = req.body;
    
    console.log('Sending OTP email to:', email);

    const html = `
      <h1>Password Reset</h1>
      <p>Your OTP for password reset is: <strong>${otp}</strong></p>
      <p>This OTP will expire in 10 minutes.</p>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.FROM_EMAIL,
      to: email,
      subject: 'Password Reset OTP - ' + companyName,
      html
    });

    res.status(200).json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Email send failed:', err);
    next(err);
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log('Email Service running on port ' + PORT));