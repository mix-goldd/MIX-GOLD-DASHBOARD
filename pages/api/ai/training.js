const { requireAuth } = require('../../../lib/api-auth');
const training = require('../../../lib/localCommandTraining');

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ training: await training.getTraining(session.id) });
    }
    if (req.method === 'POST') {
      const saved = await training.addTrainingExample(session.id, req.body);
      return res.status(201).json({ training: saved });
    }
    if (req.method === 'PATCH') {
      const saved = await training.updateTrainingExample(session.id, req.body?.id, req.body);
      return res.status(200).json({ training: saved });
    }
    if (req.method === 'DELETE') {
      const id = req.query?.id || req.body?.id;
      const saved = await training.deleteTrainingExample(session.id, id);
      return res.status(200).json({ training: saved });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'تعذر تحديث عبارات التدريب المحلية.' });
  }
}
