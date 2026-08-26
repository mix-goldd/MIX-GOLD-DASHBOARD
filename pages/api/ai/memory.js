const { requireAuth } = require('../../../lib/api-auth');
const aiMemory = require('../../../lib/aiMemory');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ memory: await aiMemory.getMemory(session.id) });
    }

    if (req.method === 'POST') {
      const memory = await aiMemory.addRule(session.id, req.body?.text, 'manual');
      return res.status(201).json({ memory });
    }

    if (req.method === 'PATCH') {
      const memory = await aiMemory.updateRule(session.id, req.body?.id, req.body?.text);
      return res.status(200).json({ memory });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id || req.body?.id;
      const memory = await aiMemory.deleteRule(session.id, id);
      return res.status(200).json({ memory });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر تحديث ذاكرة المساعد.' });
  }
}
