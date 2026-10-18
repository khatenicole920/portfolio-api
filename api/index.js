const connectToDatabase = require('../db');
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  name:    { type: String, required: true, maxlength: 100 },
  email:   { type: String, required: true, maxlength: 200 },
  message: { type: String, required: true, maxlength: 2000 }
}, { timestamps: true });

const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://khatenicole920.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    await connectToDatabase();
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    await Message.create({ name, email, message });
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};
