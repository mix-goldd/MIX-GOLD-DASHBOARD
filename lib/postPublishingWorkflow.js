const WORKFLOW_VERSION = 1;

const STATUS = {
  NEEDS_SCHEDULE: 'needs_schedule',
  SCHEDULED: 'scheduled',
  READY_FOR_APPROVAL: 'ready_for_approval',
  APPROVED_FOR_MANUAL_SHARE: 'approved_for_manual_share',
  CONFIRMED_SHARED: 'confirmed_shared',
  SKIPPED: 'skipped',
};

function emptyWorkflow() {
  return { version: WORKFLOW_VERSION, items: {} };
}

function normalizeWorkflow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyWorkflow();
  const items = value.items && typeof value.items === 'object' && !Array.isArray(value.items) ? value.items : {};
  return { version: WORKFLOW_VERSION, items };
}

function parseScheduledAt(value) {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getPostWorkflow(workflow, postId, now = new Date()) {
  const item = normalizeWorkflow(workflow).items[String(postId)];
  if (!item || !item.status) return { status: STATUS.NEEDS_SCHEDULE, scheduled_at: null };

  if (item.status === STATUS.SCHEDULED) {
    const scheduledAt = parseScheduledAt(item.scheduled_at);
    if (scheduledAt && new Date(scheduledAt).getTime() <= now.getTime()) {
      return { ...item, status: STATUS.READY_FOR_APPROVAL, scheduled_at: scheduledAt };
    }
    return { ...item, status: STATUS.SCHEDULED, scheduled_at: scheduledAt };
  }

  return { ...item, scheduled_at: parseScheduledAt(item.scheduled_at) };
}

function updatePostWorkflow(workflow, { action, postId, scheduledAt, reason, now = new Date() }) {
  const normalized = normalizeWorkflow(workflow);
  const id = String(postId || '').trim();
  if (!id) throw new Error('معرّف المنشور مطلوب');
  const timestamp = now.toISOString();
  const previous = getPostWorkflow(normalized, id, now);
  const next = { ...normalized, items: { ...normalized.items } };

  if (action === 'remove') {
    delete next.items[id];
    return next;
  }

  if (action === 'schedule') {
    const parsed = parseScheduledAt(scheduledAt);
    if (!parsed) throw new Error('موعد الجدولة غير صالح');
    if (new Date(parsed).getTime() <= now.getTime()) throw new Error('اختر موعدًا في المستقبل');
    next.items[id] = { status: STATUS.SCHEDULED, scheduled_at: parsed, updated_at: timestamp };
    return next;
  }

  if (action === 'approve') {
    if (![STATUS.READY_FOR_APPROVAL, STATUS.NEEDS_SCHEDULE, STATUS.SCHEDULED].includes(previous.status)) {
      throw new Error('لا يمكن اعتماد هذا المنشور في حالته الحالية');
    }
    next.items[id] = { ...previous, status: STATUS.APPROVED_FOR_MANUAL_SHARE, approved_at: timestamp, updated_at: timestamp };
    return next;
  }

  if (action === 'confirm_shared') {
    if (previous.status !== STATUS.APPROVED_FOR_MANUAL_SHARE) {
      throw new Error('افتح المشاركة واعتمدها أولًا قبل تأكيد الإتمام');
    }
    next.items[id] = { ...previous, status: STATUS.CONFIRMED_SHARED, shared_at: timestamp, updated_at: timestamp };
    return next;
  }

  if (action === 'skip') {
    const note = (reason || '').toString().trim();
    if (!note) throw new Error('اكتب سبب التخطي قبل إنهاء هذا التذكير');
    next.items[id] = { ...previous, status: STATUS.SKIPPED, skipped_at: timestamp, skip_reason: note, updated_at: timestamp };
    return next;
  }

  throw new Error('إجراء حالة النشر غير معروف');
}

function getWorkflowLabel(item) {
  const state = item?.status || STATUS.NEEDS_SCHEDULE;
  if (state === STATUS.SCHEDULED) return 'مجدول للمشاركة';
  if (state === STATUS.READY_FOR_APPROVAL) return 'موعد المشاركة حان — بانتظار اعتمادك';
  if (state === STATUS.APPROVED_FOR_MANUAL_SHARE) return 'تم الاعتماد — بانتظار تأكيد المشاركة';
  if (state === STATUS.CONFIRMED_SHARED) return 'تم تأكيد المشاركة';
  if (state === STATUS.SKIPPED) return 'تم التخطي مع سبب';
  return 'بانتظار جدولة المشاركة';
}

module.exports = {
  STATUS,
  emptyWorkflow,
  normalizeWorkflow,
  getPostWorkflow,
  updatePostWorkflow,
  getWorkflowLabel,
};
