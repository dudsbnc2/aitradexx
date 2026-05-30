"""
Email service using aiosmtplib (async SMTP).
Falls back to logging if SMTP not configured.
"""
import aiosmtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from app.core.config import settings

logger = logging.getLogger("tradeia.email")


def _build_otp_html(code: str, username: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your AIMasterCrypto account</title>
</head>
<body style="margin:0;padding:0;background:#020b14;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;padding:0 16px;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0a1f35,#071524);border:1px solid #1a3a5c;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#00d4ff15,#b366ff10);padding:32px;text-align:center;border-bottom:1px solid #1a3a5c;">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;background:linear-gradient(135deg,#00d4ff,#0066aa);border-radius:14px;margin-bottom:16px;">
          <span style="color:white;font-size:24px;">⚡</span>
        </div>
        <h1 style="margin:0;font-size:22px;font-weight:800;color:#e8f4ff;letter-spacing:-0.5px;">AIMasterCrypto</h1>
        <p style="margin:4px 0 0;font-size:11px;color:#3d5a73;letter-spacing:2px;text-transform:uppercase;font-family:monospace;">Institutional AI Trading</p>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8ba3be;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Hello, {username}</p>
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#e8f4ff;">Verify your email address</h2>
        <p style="margin:0 0 24px;font-size:14px;color:#8ba3be;line-height:1.6;">
          Use the code below to activate your account. It expires in <strong style="color:#00d4ff;">10 minutes</strong>.
        </p>

        <!-- OTP Box -->
        <div style="background:#071524;border:1px solid #00d4ff30;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
          <p style="margin:0 0 8px;font-size:11px;color:#3d5a73;font-family:monospace;text-transform:uppercase;letter-spacing:2px;">Verification Code</p>
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#00d4ff;font-family:monospace;text-shadow:0 0 20px #00d4ff50;">{code}</div>
        </div>

        <div style="background:#ff446608;border:1px solid #ff446620;border-radius:8px;padding:12px 16px;margin:0 0 24px;">
          <p style="margin:0;font-size:12px;color:#8ba3be;font-family:monospace;">
            🔒 Never share this code with anyone. AIMasterCrypto will never ask for it.
          </p>
        </div>

        <p style="margin:0;font-size:12px;color:#3d5a73;">
          Didn't create an account? You can safely ignore this email.
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#071524;padding:20px 32px;border-top:1px solid #1a3a5c;text-align:center;">
        <p style="margin:0;font-size:11px;color:#3d5a73;font-family:monospace;">
          © 2025 AIMasterCrypto · <a href="https://aimastercrypto.com" style="color:#00d4ff;text-decoration:none;">aimastercrypto.com</a>
        </p>
        <p style="margin:4px 0 0;font-size:10px;color:#1a3a5c;font-family:monospace;">Not financial advice. Trade responsibly.</p>
      </div>
    </div>
  </div>
</body>
</html>
"""


async def send_verification_email(to_email: str, username: str, code: str) -> bool:
    """Send OTP verification email. Returns True on success."""
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.warning(f"[EMAIL] SMTP not configured — OTP for {to_email}: {code}")
        return True  # Dev mode: just log the code

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Verify your AIMasterCrypto account"
    msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
    msg["To"] = to_email

    html_part = MIMEText(_build_otp_html(code, username), "html", "utf-8")
    msg.attach(html_part)

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
            start_tls=True,
        )
        logger.info(f"[EMAIL] Verification email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"[EMAIL] Failed to send to {to_email}: {e}")
        return False
