import { env } from '../../config/env.js';

// Deliberately reports only booleans/non-secret fields — never the API
// key or secret key themselves. Exists so a treasurer/admin can check
// "is SMS actually configured" from the app itself instead of needing
// PM2 log access on the server (client requirement: "Add safe
// diagnostics such as: configured = true/false, provider = beem, sender
// configured = true/false").
export async function status(req, res, next) {
  try {
    const configured = env.sms.provider === 'beem';
    res.json({
      success: true,
      data: {
        provider: env.sms.provider,
        configured,
        senderConfigured: Boolean(env.sms.beem.senderId),
        apiUrlConfigured: Boolean(env.sms.beem.apiUrl),
      },
    });
  } catch (err) {
    next(err);
  }
}
