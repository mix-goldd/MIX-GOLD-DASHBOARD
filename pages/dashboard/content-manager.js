import { useState } from 'react';
import Layout from '../../components/Layout';
import Dropdown from '../../components/Dropdown';
import { getSessionFromReq } from '../../lib/auth';
import { getSetting } from '../../lib/siteDb';
import { SIDEBAR_PARENTS, CORE_NAV_ITEMS, normalizeCategories } from '../../lib/animeContent';

const DEFAULT_CATEGORIES = ['Shonen', 'Seinen', 'Shojo', 'Isekai', 'Mecha', 'Slice of Life'];

export async function getServerSideProps({ req }) {
  const session = getSessionFromReq(req);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  let categories = DEFAULT_CATEGORIES;
  let sidebarItems = [];
  let homepageSections = {};
  let navLocks = {};
  try {
    [categories, sidebarItems, homepageSections, navLocks] = await Promise.all([
      getSetting('video_categories', DEFAULT_CATEGORIES),
      getSetting('sidebar_items', []),
      getSetting('homepage_sections', {}),
      getSetting('nav_locks', {}),
    ]);
  } catch (err) {
    console.error('تعذر جلب إعدادات الموقع:', err.message);
  }
  return {
    props: {
      session,
      categories: normalizeCategories(categories),
      sidebarItems,
      homepageSections,
      navLocks: navLocks && typeof navLocks === 'object' && !Array.isArray(navLocks) ? navLocks : {},
    },
  };
}

const HELP_TEXT = {
  categories: 'تصنيفات المحتوى: أضف أو احذف تصنيفات المحتوى (أكشن، دراما، كوميديا، عائلي، رسوم متحركة، إلخ). اسحب المقبض لإعادة الترتيب، اضغط القلم لإعادة التسمية، واستخدم المفتاح لتفعيل التصنيف أو تعطيله دون حذفه. تظهر هذه عند إضافة محتوى جديد.',
  sidebar: 'عناصر القائمة الجانبية: إدارة روابط تنقل مخصصة للموقع. استخدم الأسهم لإعادة الترتيب، والقلم للتعديل، وسلة المهملات للحذف.',
  homepage: "أقسام الصفحة الرئيسية: أضف أقسامًا مخصصة (مثال: 'الأكثر مشاهدة'، 'أضيف حديثاً'، 'أفلام ومسلسلات') للصفحة الرئيسية.",
  navLocks: 'أقسام الموقع الأساسية: هذه أقسام القائمة الجانبية الثابتة في الموقع (الرئيسية، الفيديوهات، الموديلز...). عند قفل قسم، يظل ظاهرًا للزوار لكن بأيقونة قفل، ولا يفتح عند الضغط عليه — يظهر تنبيه أنه سيتوفر لاحقًا.',
};

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'فشل الحفظ');
  }
  return res.json();
}

export default function ContentManager({ session, categories: initialCategories, sidebarItems: initialSidebarItems, homepageSections: initialHomepageSections, navLocks: initialNavLocks }) {
  const [categories, setCategories] = useState(initialCategories);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [draggedCatIndex, setDraggedCatIndex] = useState(null);
  const [dragOverCatIndex, setDragOverCatIndex] = useState(null);

  const [navLocks, setNavLocks] = useState(initialNavLocks || {});

  const [sidebarItems, setSidebarItems] = useState(initialSidebarItems);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemIcon, setNewItemIcon] = useState('');
  const [newItemParent, setNewItemParent] = useState('main');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: '', icon: '', parentId: 'main' });

  const [sections, setSections] = useState(initialHomepageSections);
  const [newSection, setNewSection] = useState('');

  const [help, setHelp] = useState(null);
  const [publishError, setPublishError] = useState(null);

  function reportError(err) {
    setPublishError(err.message || 'حدث خطأ أثناء النشر على الموقع');
  }

  // ---- categories ----
  function persistCategories(next) {
    setCategories(next);
    postJSON('/api/content/categories', { categories: next }).catch(reportError);
  }
  function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    if (categories.some((c) => c.name === name)) return alert('التصنيف موجود بالفعل');
    persistCategories([...categories, { name, enabled: true }]);
    setNewCategory('');
  }
  function deleteCategory(name) {
    if (!confirm(`حذف التصنيف "${name}"؟`)) return;
    persistCategories(categories.filter((c) => c.name !== name));
  }
  function toggleCategory(name) {
    persistCategories(categories.map((c) => (c.name === name ? { ...c, enabled: !c.enabled } : c)));
  }
  function startEditCategory(cat) {
    setEditingCategory(cat.name);
    setCategoryDraft(cat.name);
  }
  function cancelEditCategory() {
    setEditingCategory(null);
    setCategoryDraft('');
  }
  function saveEditCategory(originalName) {
    const name = categoryDraft.trim();
    if (!name) return alert('الاسم مطلوب');
    if (name !== originalName && categories.some((c) => c.name === name)) return alert('التصنيف موجود بالفعل');
    persistCategories(categories.map((c) => (c.name === originalName ? { ...c, name } : c)));
    setEditingCategory(null);
    setCategoryDraft('');
  }
  function handleCatDragStart(index) {
    setDraggedCatIndex(index);
  }
  function handleCatDragOver(e, index) {
    e.preventDefault();
    setDragOverCatIndex(index);
    if (draggedCatIndex === null || draggedCatIndex === index) return;
    const next = [...categories];
    const [moved] = next.splice(draggedCatIndex, 1);
    next.splice(index, 0, moved);
    setDraggedCatIndex(index);
    setCategories(next);
  }
  function handleCatDrop() {
    postJSON('/api/content/categories', { categories }).catch(reportError);
    setDraggedCatIndex(null);
    setDragOverCatIndex(null);
  }
  function handleCatDragEnd() {
    setDraggedCatIndex(null);
    setDragOverCatIndex(null);
  }

  // ---- core section locks ----
  function toggleNavLock(key) {
    const next = { ...navLocks, [key]: !navLocks[key] };
    setNavLocks(next);
    postJSON('/api/content/nav-locks', { locks: next }).catch(reportError);
  }

  // ---- sidebar items ----
  function addSidebarItem() {
    const name = newItemName.trim();
    if (!name) return alert('الرجاء إدخال اسم القائمة');
    const icon = newItemIcon.trim() || 'fas fa-dragon';
    const next = [
      ...sidebarItems,
      { id: Date.now().toString(), name, icon, parentId: newItemParent, enabled: true },
    ];
    setSidebarItems(next);
    setNewItemName('');
    setNewItemIcon('');
    setShowAddItem(false);
    postJSON('/api/content/sidebar-items', { items: next }).catch(reportError);
  }
  function deleteSidebarItem(id) {
    if (!confirm('حذف هذا العنصر؟')) return;
    const next = sidebarItems.filter((i) => i.id !== id);
    setSidebarItems(next);
    postJSON('/api/content/sidebar-items', { items: next }).catch(reportError);
  }
  function moveItem(id, dir) {
    const items = [...sidebarItems];
    const idx = items.findIndex((i) => i.id === id);
    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= items.length) return;
    [items[idx], items[swapWith]] = [items[swapWith], items[idx]];
    setSidebarItems(items);
    postJSON('/api/content/sidebar-items', { items }).catch(reportError);
  }
  function startEdit(item) {
    setEditingId(item.id);
    setEditDraft({ name: item.name, icon: item.icon, parentId: item.parentId });
  }
  function saveEdit(id) {
    if (!editDraft.name.trim()) return alert('الاسم مطلوب');
    const next = sidebarItems.map((i) =>
      i.id === id ? { ...i, name: editDraft.name.trim(), icon: editDraft.icon.trim() || 'fas fa-dragon', parentId: editDraft.parentId } : i
    );
    setSidebarItems(next);
    setEditingId(null);
    postJSON('/api/content/sidebar-items', { items: next }).catch(reportError);
  }

  // ---- homepage sections ----
  function addSection() {
    const name = newSection.trim();
    if (!name) return;
    if (sections[name]) return alert('القسم موجود بالفعل');
    const next = { ...sections, [name]: true };
    setSections(next);
    setNewSection('');
    postJSON('/api/content/homepage-sections', { sections: next }).catch(reportError);
  }
  function deleteSection(name) {
    if (!confirm(`حذف القسم "${name}"؟`)) return;
    const next = { ...sections };
    delete next[name];
    setSections(next);
    postJSON('/api/content/homepage-sections', { sections: next }).catch(reportError);
  }

  function parentLabel(value) {
    return SIDEBAR_PARENTS.find((p) => p.value === value)?.label || SIDEBAR_PARENTS[0].label;
  }

  return (
    <Layout title="مدير المحتوى" session={session}>
      <div dir="rtl" className="am-panel">
        <p className="helper-text" style={{ marginBottom: 16 }}>
          تخصيص القائمة الجانبية، أقسام الصفحة الرئيسية، وتصنيفات المحتوى. أي تغيير هنا ينشر مباشرة على الموقع.
        </p>

        {publishError && (
          <div className="banner banner-error" onClick={() => setPublishError(null)}>
            تعذّر النشر على الموقع: {publishError}
          </div>
        )}

        {/* Categories */}
        <div className="card am-settings-section">
          <div className="am-settings-title">
            <i className="fas fa-tags" /> تصنيفات المحتوى
            <button className="am-help-icon" onClick={() => setHelp('categories')} title="مساعدة">
              <i className="fas fa-question-circle" />
            </button>
          </div>
          {categories.map((c, idx) =>
            editingCategory === c.name ? (
              <div className="am-edit-form" key={c.name}>
                <input
                  className="am-input"
                  value={categoryDraft}
                  onChange={(e) => setCategoryDraft(e.target.value)}
                  placeholder="اسم التصنيف"
                  autoFocus
                />
                <button className="btn btn-primary" onClick={() => saveEditCategory(c.name)}>
                  حفظ
                </button>
                <button className="btn" onClick={cancelEditCategory}>
                  إلغاء
                </button>
              </div>
            ) : (
              <div
                className={`am-category-row${draggedCatIndex === idx ? ' am-dragging' : ''}${
                  dragOverCatIndex === idx && draggedCatIndex !== idx ? ' am-drag-over' : ''
                }`}
                key={c.name}
                draggable
                onDragStart={() => handleCatDragStart(idx)}
                onDragOver={(e) => handleCatDragOver(e, idx)}
                onDrop={handleCatDrop}
                onDragEnd={handleCatDragEnd}
              >
                <div className="am-category-drag-handle" title="اسحب لإعادة الترتيب">
                  <i className="fas fa-grip-lines" />
                </div>
                <span className={`am-category-name${c.enabled ? '' : ' am-category-disabled'}`}>{c.name}</span>
                <div className="am-item-actions">
                  <button onClick={() => deleteCategory(c.name)} title="حذف">
                    <i className="fas fa-trash" />
                  </button>
                  <button onClick={() => startEditCategory(c)} title="تعديل">
                    <i className="fas fa-pencil-alt" />
                  </button>
                  <label className="am-toggle" title={c.enabled ? 'مفعّل — اضغط للتعطيل' : 'معطّل — اضغط للتفعيل'}>
                    <input type="checkbox" checked={c.enabled} onChange={() => toggleCategory(c.name)} />
                    <span className="am-toggle-slider"></span>
                  </label>
                </div>
              </div>
            )
          )}
          <div className="am-inline-add">
            <input
              className="am-input"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="اسم التصنيف الجديد"
            />
            <button className="btn btn-primary" onClick={addCategory}>
              <i className="fas fa-plus" /> إضافة
            </button>
          </div>
        </div>

        {/* Core site sections (lockable) */}
        <div className="card am-settings-section">
          <div className="am-settings-title">
            <i className="fas fa-lock" /> أقسام الموقع الأساسية
            <button className="am-help-icon" onClick={() => setHelp('navLocks')} title="مساعدة">
              <i className="fas fa-question-circle" />
            </button>
          </div>
          {CORE_NAV_ITEMS.map((item) => {
            const locked = !!navLocks[item.key];
            return (
              <div className="am-setting-item" key={item.key}>
                <span>
                  {item.label}
                  {locked && <i className="fas fa-lock am-nav-lock-badge" title="مقفول للزوار" />}
                </span>
                <label className="am-toggle" title={locked ? 'مقفول — اضغط للفتح' : 'مفتوح — اضغط للقفل'}>
                  <input type="checkbox" checked={!locked} onChange={() => toggleNavLock(item.key)} />
                  <span className="am-toggle-slider"></span>
                </label>
              </div>
            );
          })}
        </div>

        {/* Sidebar items */}
        <div className="card am-settings-section">
          <div className="am-settings-title">
            <i className="fas fa-list" /> عناصر القائمة الجانبية
            <button className="am-help-icon" onClick={() => setHelp('sidebar')} title="مساعدة">
              <i className="fas fa-question-circle" />
            </button>
          </div>

          {sidebarItems.length === 0 ? (
            <p className="helper-text">لا توجد عناصر بعد. انقر "إضافة عنصر جديد" أدناه.</p>
          ) : (
            sidebarItems.map((item, idx) =>
              editingId === item.id ? (
                <div className="am-edit-form" key={item.id}>
                  <input
                    className="am-input"
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    placeholder="الاسم"
                  />
                  <input
                    className="am-input"
                    value={editDraft.icon}
                    onChange={(e) => setEditDraft({ ...editDraft, icon: e.target.value })}
                    placeholder="الأيقونة"
                  />
                  <Dropdown
                    value={editDraft.parentId}
                    onChange={(v) => setEditDraft({ ...editDraft, parentId: v })}
                    options={SIDEBAR_PARENTS}
                  />
                  <button className="btn btn-primary" onClick={() => saveEdit(item.id)}>
                    حفظ
                  </button>
                  <button className="btn" onClick={() => setEditingId(null)}>
                    إلغاء
                  </button>
                </div>
              ) : (
                <div className="am-sidebar-row" key={item.id}>
                  <div className="am-item-info">
                    <i className={item.icon} />
                    <span>
                      {item.name} <small style={{ opacity: 0.7 }}>({parentLabel(item.parentId)})</small>
                    </span>
                  </div>
                  <div className="am-item-actions">
                    <button onClick={() => deleteSidebarItem(item.id)} title="حذف">
                      <i className="fas fa-trash" />
                    </button>
                    <button onClick={() => startEdit(item)} title="تعديل">
                      <i className="fas fa-pencil-alt" />
                    </button>
                    <button onClick={() => moveItem(item.id, 'down')} disabled={idx === sidebarItems.length - 1} title="تحريك لأسفل">
                      <i className="fas fa-arrow-down" />
                    </button>
                    <button onClick={() => moveItem(item.id, 'up')} disabled={idx === 0} title="تحريك لأعلى">
                      <i className="fas fa-arrow-up" />
                    </button>
                  </div>
                </div>
              )
            )
          )}

          {showAddItem && (
            <div className="am-inline-add am-wrap">
              <input
                className="am-input"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="اسم القائمة"
              />
              <input
                className="am-input"
                value={newItemIcon}
                onChange={(e) => setNewItemIcon(e.target.value)}
                placeholder="أيقونة (fas fa-dragon)"
              />
              <Dropdown
                value={newItemParent}
                onChange={setNewItemParent}
                options={SIDEBAR_PARENTS}
              />
              <button className="btn btn-primary" onClick={addSidebarItem}>
                <i className="fas fa-plus" /> إضافة
              </button>
            </div>
          )}
          <div className="am-add-link" onClick={() => setShowAddItem(!showAddItem)}>
            <i className="fas fa-plus" /> إضافة عنصر جديد
          </div>
          <p className="helper-text" style={{ marginTop: 8 }}>
            أيقونات من FontAwesome (مثال: fas fa-home, fas fa-cog)
          </p>
        </div>

        {/* Homepage sections */}
        <div className="card am-settings-section">
          <div className="am-settings-title">
            <i className="fas fa-th-large" /> أقسام الصفحة الرئيسية
            <button className="am-help-icon" onClick={() => setHelp('homepage')} title="مساعدة">
              <i className="fas fa-question-circle" />
            </button>
          </div>
          {Object.keys(sections).map((name) => (
            <div className="am-setting-item" key={name}>
              <span>{name}</span>
              <button className="am-icon-btn" onClick={() => deleteSection(name)}>
                <i className="fas fa-trash" /> حذف
              </button>
            </div>
          ))}
          <div className="am-inline-add">
            <input
              className="am-input"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              placeholder="اسم القسم"
            />
            <button className="btn btn-primary" onClick={addSection}>
              <i className="fas fa-plus" /> إضافة
            </button>
          </div>
        </div>

        {help && (
          <div className="am-help-modal" onClick={() => setHelp(null)}>
            <div className="am-help-modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="am-help-modal-close" onClick={() => setHelp(null)}>
                &times;
              </button>
              <h3>مساعدة</h3>
              <p>{HELP_TEXT[help]}</p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
