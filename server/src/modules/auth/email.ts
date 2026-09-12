import { config } from '../../config/env.js';

export class EmailDeliveryError extends Error {
  code = 'email_delivery_failed';
  statusCode = 503;
}

export async function sendAuthCodeEmail({ to, code, purpose }: { to: string; code: string; purpose: 'password_reset' | 'email_change' }): Promise<void> {
  if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
    throw Object.assign(new EmailDeliveryError('E-mail transacional não configurado.'), { code: 'email_not_configured' });
  }

  const isRecovery = purpose === 'password_reset';
  const subject = isRecovery ? 'Código para recuperar sua conta Linkord' : 'Confirme seu novo e-mail no Linkord';
  const title = isRecovery ? 'Recuperação de conta' : 'Confirmação de e-mail';
  const intro = isRecovery
    ? 'Use este código para redefinir a senha da sua conta Linkord:'
    : 'Use este código para confirmar o novo e-mail da sua conta Linkord:';
  const appLine = config.APP_URL ? `Você também pode acessar ${config.APP_URL}.` : '';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.RESEND_FROM_EMAIL,
      to: [to],
      subject,
      text: `${title}\n\n${intro}\n\n${code}\n\nO código expira em 30 minutos. Se você não solicitou isso, ignore este e-mail.\n${appLine}`,
      html: `<h2>${title}</h2><p>${intro}</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>O código expira em 30 minutos. Se você não solicitou isso, ignore este e-mail.</p><p>${appLine}</p>`,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new EmailDeliveryError(`Resend recusou o envio (${response.status}): ${details.slice(0, 200)}`);
  }
}
