const express = require('express');
const app = express();
app.use(express.json());

// ============================================================
//  CONFIG — Set these as Vercel environment variables
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MINI_APP_URL = process.env.MINI_APP_URL || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============================================================
//  PRODUCTS
// ============================================================
const PRODUCTS = {
  extra_3: {
    title: '3 Extra Predictions',
    description: 'Play 3 more ChainCheck predictions today + 50 $CHECKS bonus',
    stars: 25,
    payload: 'extra_3',
  },
  extra_10: {
    title: '10 Extra Predictions',
    description: 'Play 10 more ChainCheck predictions today + 200 $CHECKS bonus',
    stars: 75,
    payload: 'extra_10',
  },
  streak_shield: {
    title: 'Streak Shield',
    description: 'Protect your streak — miss 1 day without losing it',
    stars: 50,
    payload: 'streak_shield',
  },
  checks_500: {
    title: '500 $CHECKS',
    description: 'Instant $CHECKS balance boost',
    stars: 30,
    payload: 'checks_500',
  },
  checks_2000: {
    title: '2,000 $CHECKS',
    description: 'Jump straight to Silver tier',
    stars: 100,
    payload: 'checks_2000',
  },
};

// CORS — allow Mini App to call this server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============================================================
//  CREATE INVOICE — called by the Mini App
// ============================================================
app.post('/create-invoice', async (req, res) => {
  const { productId, userId } = req.body;
  const product = PRODUCTS[productId];

  if (!product) return res.status(400).json({ error: 'Unknown product' });
  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });

  try {
    const response = await fetch(`${TG_API}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: product.title,
        description: product.description,
        payload: JSON.stringify({ productId, userId, ts: Date.now() }),
        currency: 'XTR',
        prices: [{ label: product.title, amount: product.stars }],
      }),
    });

    const data = await response.json();

    if (data.ok && data.result) {
      res.json({ invoiceLink: data.result });
    } else {
      console.error('Telegram API error:', data);
      res.status(500).json({ error: 'Failed to create invoice', detail: data.description });
    }
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
//  WEBHOOK — receives pre-checkout and payment confirmations
// ============================================================
app.post('/webhook', async (req, res) => {
  const update = req.body;

  // Pre-checkout query — must answer within 10 seconds
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    try {
      const payload = JSON.parse(query.invoice_payload);
      const product = PRODUCTS[payload.productId];

      if (product) {
        await answerPreCheckout(query.id, true);
        console.log(`✅ Pre-checkout approved: ${payload.productId} for user ${payload.userId}`);
      } else {
        await answerPreCheckout(query.id, false, 'Unknown product');
        console.log(`❌ Pre-checkout rejected: unknown product`);
      }
    } catch (err) {
      await answerPreCheckout(query.id, true); // approve anyway to not block payment
      console.error('Pre-checkout parse error:', err);
    }
  }

  // Successful payment
  if (update.message?.successful_payment) {
    const payment = update.message.successful_payment;
    const chatId = update.message.chat.id;
    try {
      const payload = JSON.parse(payment.invoice_payload);
      console.log(`💰 Payment received: ${payload.productId} from user ${payload.userId} — ${payment.total_amount} Stars`);

      // Thank the user
      await sendMessage(chatId, `✅ Payment received! Your ${PRODUCTS[payload.productId]?.title || 'purchase'} has been applied. Open ChainCheck to use it!`);
    } catch (err) {
      console.error('Payment processing error:', err);
    }
  }

  // /start command — send welcome + open Mini App
  if (update.message?.text?.startsWith('/start')) {
    const chatId = update.message.chat.id;
    await sendMessage(chatId, '🎯 Welcome to ChainCheck!\n\nPredict crypto candles. Earn $CHECKS. Climb the leaderboard.\n\nTap the button below to play!', {
      reply_markup: {
        inline_keyboard: [[{
          text: '🎯 Play ChainCheck',
          web_app: { url: MINI_APP_URL }
        }]]
      }
    });
  }

  res.sendStatus(200);
});

// ============================================================
//  SETUP WEBHOOK — call once after deploying
// ============================================================
app.get('/setup-webhook', async (req, res) => {
  const webhookUrl = req.query.url;
  if (!webhookUrl) return res.status(400).json({ error: 'Provide ?url=https://your-domain' });

  const response = await fetch(`${TG_API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${webhookUrl}/webhook`,
      allowed_updates: ['message', 'pre_checkout_query'],
    }),
  });

  const data = await response.json();
  res.json(data);
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ChainCheck bot server running', products: Object.keys(PRODUCTS).length });
});

// ============================================================
//  HELPERS
// ============================================================
async function answerPreCheckout(queryId, ok, errorMessage) {
  await fetch(`${TG_API}/answerPreCheckoutQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pre_checkout_query_id: queryId,
      ok,
      ...(errorMessage && { error_message: errorMessage }),
    }),
  });
}

async function sendMessage(chatId, text, extra = {}) {
  await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

// ============================================================
//  START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎯 ChainCheck bot server on port ${PORT}`);
});

module.exports = app;
