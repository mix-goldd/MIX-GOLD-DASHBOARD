const { getSessionFromReq } = require('../../../lib/auth');
const { getSetting, saveSetting } = require('../../../lib/siteDb');
const { normalizeWorkflow, updatePostWorkflow } = require('../../../lib/postPublishingWorkflow');

const WORKFLOW_SETTING_KEY = 'post_publishing_workflow';

export default async function handler(req, res) {
  const session = getSessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'غير مصرح' });

  try {
    const current = normalizeWorkflow(await getSetting(WORKFLOW_SETTING_KEY, {}));

    if (req.method === 'GET') {
      return res.status(200).json({ workflow: current });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const workflow = updatePostWorkflow(current, {
        action: body.action,
        postId: body.post_id,
        scheduledAt: body.scheduled_at,
        reason: body.reason,
      });
      await saveSetting(WORKFLOW_SETTING_KEY, workflow);
      return res.status(200).json({ workflow });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تعذر حفظ حالة المشاركة' });
  }
}
