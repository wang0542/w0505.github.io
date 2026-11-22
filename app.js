/* 果果 · 个人网站 —— 云端数据 + 交互 */

const CLOUD_CONFIG = {
  endpoint: 'https://guoguo-site.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_rgjGUVYr5JkDnaV8ZQHI61_IwZpd1YsQ4s6ijx5n4ZBEO7cTcT19xp9'
};

const cloud = WorkBuddyCloud.createWorkBuddyCloud(CLOUD_CONFIG);

/* ============ 图片处理 ============ */

/* 压缩到指定最长边，转 JPEG data URL —— 存进数据库，访客直接能看 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

async function compressImage(file, maxEdge, quality) {
  const raw = await readFileAsDataUrl(file);
  const img = await loadImage(raw);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/* ============ 状态 ============ */

const state = {
  session: null,
  profile: null,
  essays: [],
  works: [],
  photos: [],
  tracks: [],
  currentPage: 'about'
};

/* 默认内容：首次访问、数据库为空时展示，也是用户替换前的示例 */
const DEFAULT_PROFILE = {
  display_name: '果果',
  tagline: '一个正在攒经验的人',
  intro: '用两三句话讲清楚：你是谁、现在在做什么、擅长什么、想找什么样的机会。',
  intro_long: '',
  avatar_url: '',
  major: '新媒体（在读）',
  city: '【填你的城市】',
  doing: '英语提升 · 知识库',
  contact: '1780206775@qq.com'
};

const DEFAULT_TRACKS = [
  { num: '01', title: '教育政策', desc: '跟教育部「政策解读」栏目，从 2025 年 11 月追到现在。已收 20 篇原文、20 张卡。', meta: '20 张卡 · 主线' },
  { num: '02', title: '时政 · 人民立场', desc: '从学习强国收人民日报、新华社的报道。刚开始，还在攒第二篇。', meta: '1 张卡 · 待补' },
  { num: '03', title: '区域发展 · 绿色算力', desc: '从乌兰察布那次考察报道切进去，捋清「算力 + 绿电」这条产业账。', meta: '1 张卡 · 待补' }
];

const DEFAULT_FACTS = [
  { label: '专业', value: '新媒体（在读）', sub: '学校、年级可在此补充' },
  { label: '所在地', value: '【填你的城市】', sub: '可写具体到区或学校附近' },
  { label: '在做的事', value: '英语提升 · 知识库', sub: '可换成你当前的真实状态' },
  { label: '联系方式', value: '1780206775@qq.com', sub: '微信 / 公众号 ID 可补充' }
];

/* ============ 工具 ============ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer;
function toast(message, isError) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function isSignedIn() {
  return !!state.session && !!state.session.user;
}

/* ============ 路由 ============ */

const PAGE_IDS = { about: 'page-about', photos: 'page-photos', essays: 'page-essays', works: 'page-works' };

function showPage(name) {
  if (!PAGE_IDS[name]) name = 'about';
  state.currentPage = name;
  Object.entries(PAGE_IDS).forEach(([key, id]) => {
    $('#' + id).classList.toggle('active', key === name);
  });
  $$('#nav a, .footer-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.page === name);
  });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function handleHash() {
  const name = (location.hash || '#about').replace('#', '');
  showPage(name);
}

window.addEventListener('hashchange', handleHash);

/* ============ 登录 ============ */

async function restoreAuth() {
  const url = new URL(location.href);
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    const { data: session } = await cloud.auth.getSession();
    state.session = session || null;
    syncAuthUI();
    return;
  }

  const provider = url.searchParams.get('provider');
  if (provider !== 'workbuddy' && provider !== 'wechat') {
    toast('授权回调缺少有效的登录方式，请重新登录。', true);
    return;
  }
  const handleCallback = provider === 'workbuddy'
    ? cloud.auth.handleWorkBuddyCallback
    : cloud.auth.handleWechatWebCallback;
  if (typeof handleCallback !== 'function') {
    toast('暂时无法使用此方式登录，请联系应用管理员。', true);
    return;
  }
  const { data: session, error } = await handleCallback.call(cloud.auth);
  if (error) {
    toast(error.message || '登录失败，请重试。', true);
  } else if (session) {
    for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    state.session = session;
    syncAuthUI();
    await claimSeedContent();
    await reloadContent();
    toast('登录成功，现在可以编辑了');
  }
}

async function reloadContent() {
  const [profile, essays, works, photos, tracks] = await Promise.all([
    loadProfile(), loadEssays(), loadWorks(), loadPhotos(), loadTracks()
  ]);
  state.profile = profile;
  state.essays = essays;
  state.works = works;
  state.photos = await resolvePhotoUrls(photos);
  if (tracks.length) state.tracks = tracks;
  renderProfile();
  renderEssays();
  renderWorks();
  renderPhotos();
}

async function startLogin() {
  const back = new URL(location.href);
  back.pathname = '/';
  for (const key of ['code', 'state', 'provider']) back.searchParams.delete(key);

  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: 'workbuddy',
    redirectTo: back.toString()
  });
  if (error) {
    toast(error.message || '登录失败，请重试。', true);
    return;
  }
  location.assign(data.url);
}

function syncAuthUI() {
  const bar = $('#loginBar');
  document.body.classList.toggle('signed-in', isSignedIn());
  if (isSignedIn()) {
    bar.classList.remove('show');
  } else {
    bar.classList.add('show');
    $('#loginBarText').textContent = '登录后可以上传照片、发布随笔、添加作品';
  }
  const name = state.session?.user?.name;
  if (name) {
    $('#brandName').textContent = name;
  }
  renderProfile();
  renderEssays();
  renderWorks();
  renderPhotos();
}

async function signOut() {
  await cloud.auth.signOut();
  state.session = null;
  syncAuthUI();
  toast('已退出登录');
}

/* ============ 认领初始内容 ============ */

/* 种入的示例内容 owner_id = 'seed'，任何登录用户首次登录时接管它，
   之后这条内容就归这个账号，RLS 会正常保护它。 */
async function claimSeedContent() {
  if (!isSignedIn()) return;
  const uid = state.session.user.id;
  const tables = ['site_profile', 'tracks', 'essays', 'works', 'photos'];
  for (const table of tables) {
    try {
      const { data } = await cloud.database
        .from(table)
        .update({ owner_id: uid })
        .eq('owner_id', 'seed')
        .select('id');
      if (data && data.length) {
        console.log(`[site] claimed ${data.length} seed rows in ${table}`);
      }
    } catch (e) {
      console.warn(`[site] claim ${table} failed:`, e && e.message);
    }
  }
}

/* ============ 数据读取 ============ */

/* 云端只认已登记的域名，其它域名读不到数据时回退到随仓库发布的静态快照 */
let snapshotPromise;
function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = fetch('./data.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return snapshotPromise;
}

async function loadProfile() {
  const { data, error } = await cloud.database
    .from('site_profile')
    .select('*')
    .order('id', { ascending: true })
    .limit(1);
  if (error) {
    console.warn('[site] profile read failed:', error.message);
  } else if (data && data.length) {
    return data[0];
  }
  const snapshot = await loadSnapshot();
  return (snapshot && snapshot.site_profile) || null;
}

async function loadEssays() {
  const { data, error } = await cloud.database
    .from('essays')
    .select('*')
    .order('published_at', { ascending: false });
  if (!error && data && data.length) return data;
  if (error) console.warn('[site] essays read failed:', error.message);
  const snapshot = await loadSnapshot();
  return (snapshot && Array.isArray(snapshot.essays) && snapshot.essays) || [];
}

async function loadWorks() {
  const { data, error } = await cloud.database
    .from('works')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (!error && data && data.length) return data;
  if (error) console.warn('[site] works read failed:', error.message);
  const snapshot = await loadSnapshot();
  return (snapshot && Array.isArray(snapshot.works) && snapshot.works) || [];
}

async function loadPhotos() {
  const { data, error } = await cloud.database
    .from('photos')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (!error && data && data.length) return data;
  if (error) console.warn('[site] photos read failed:', error.message);
  const snapshot = await loadSnapshot();
  return (snapshot && Array.isArray(snapshot.photos) && snapshot.photos) || [];
}

async function loadTracks() {
  const { data, error } = await cloud.database
    .from('tracks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (!error && data && data.length) return data;
  if (error) console.warn('[site] tracks read failed:', error.message);
  const snapshot = await loadSnapshot();
  return (snapshot && Array.isArray(snapshot.tracks) && snapshot.tracks) || [];
}

/* 照片存在数据库里，公开可读；image_data 是压缩后的 data URL */
async function resolvePhotoUrls(rows) {
  return rows.map((row) => ({
    ...row,
    url: row.image_data || (row.image_path ? '' : '')
  }));
}

/* ============ 渲染 ============ */

function renderProfile() {
  const p = state.profile || DEFAULT_PROFILE;
  const name = p.display_name || '果果';
  $('#brandName').textContent = name;
  $('#footerName').textContent = name;
  $('#aboutTitle').textContent = `你好，我是${name}`;
  $('#aboutTagline').textContent = p.tagline || '';
  $('#aboutIntro').textContent = p.intro || '';

  /* 自我介绍正文：按空行分成段落 */
  const story = $('#aboutStory');
  const storySection = story.closest('.section-story');
  const storyText = p.intro_long || '';
  if (storyText.trim()) {
    story.innerHTML = storyText
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join('');
    storySection.hidden = false;
  } else {
    story.innerHTML = '';
    storySection.hidden = true;
  }

  const footerDesc = [p.major, p.doing].filter(Boolean).join(' · ');
  $('#footerDesc').textContent = footerDesc || '个人网站';

  const portrait = $('#portrait');
  const avatarSrc = p.avatar_data || p.avatar_url || '';
  if (avatarSrc) {
    portrait.classList.add('has-image');
    portrait.innerHTML = `<img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(name)}的照片">`;
  } else {
    portrait.classList.remove('has-image');
    portrait.innerHTML = `
      <div class="portrait-empty">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 8.5A2.5 2.5 0 016.5 6h1.2a2 2 0 011.7-1l.5-.4a1 1 0 01.8-.3h5.6a1 1 0 01.8.3l.5.4a2 2 0 011.7 1h1.2A2.5 2.5 0 0120 8.5v8a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5v-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <span>${isSignedIn() ? '上传你的照片' : '照片待上传'}</span>
      </div>`;
  }

  const facts = [
    { label: '专业', value: p.major || '【填你的专业】', sub: '学校、年级可在此补充' },
    { label: '所在地', value: p.city || '【填你的城市】', sub: '可写具体到区或学校附近' },
    { label: '在做的事', value: p.doing || '【填你正在做的事】', sub: '可换成你当前的真实状态' },
    { label: '联系方式', value: p.contact || '【填你的联系方式】', sub: '微信 / 公众号 ID 可补充' }
  ];
  $('#factGrid').innerHTML = facts.map((f) => `
    <div class="fact">
      <div class="fact-label">${escapeHtml(f.label)}</div>
      <div class="fact-value">${escapeHtml(f.value)}</div>
      <div class="fact-sub">${escapeHtml(f.sub)}</div>
    </div>`).join('');

  $('#trackGrid').innerHTML = state.tracks.map((t, i) => `
    <div class="track">
      <div class="track-num">${escapeHtml(t.num)}</div>
      <div class="track-title">${escapeHtml(t.title)}</div>
      <div class="track-desc">${escapeHtml(t.description || t.desc)}</div>
      <div class="track-meta">${escapeHtml(t.meta)}</div>
      ${isSignedIn() ? `<button class="track-edit" data-edit-track="${i}">编辑</button>` : ''}
    </div>`).join('');
}

function renderEssays() {
  const list = $('#essayList');
  if (!state.essays.length) {
    list.innerHTML = '<div class="empty-state">还没有随笔。登录后点「写新随笔」发布第一篇。</div>';
    return;
  }
  const tagClass = (tag) => {
    if (tag === '读书笔记' || tag === '视频剪辑' || tag === '时政观察') return 'tag violet';
    if (tag === '区域观察' || tag === '区域发展') return 'tag amber';
    return 'tag';
  };
  list.innerHTML = state.essays.map((e) => `
    <article class="essay-row">
      <div class="essay-date">${escapeHtml(formatDate(e.published_at))}</div>
      <div>
        <h3 class="essay-title"><button class="essay-title-btn" data-read-essay="${e.id}">${escapeHtml(e.title)}</button></h3>
        ${e.excerpt ? `<p class="essay-excerpt">${escapeHtml(e.excerpt)}</p>` : ''}
        <div class="essay-meta">
          <span class="${tagClass(e.tag)}">${escapeHtml(e.tag)}</span>
          ${e.body ? `<button class="essay-read" data-read-essay="${e.id}">阅读全文</button>` : ''}
          ${isSignedIn() ? `<button class="essay-del" data-delete-essay="${e.id}">删除</button>` : ''}
        </div>
      </div>
    </article>`).join('');
}

function renderWorks() {
  const grid = $('#workGrid');
  if (!state.works.length) {
    grid.innerHTML = '<div class="empty-state">还没有作品。登录后点「添加新作品」放第一个。</div>';
    return;
  }
  grid.innerHTML = state.works.map((w) => {
    const coverSrc = w.cover_data || w.cover_url || '';
    return `
    <article class="work">
      <div class="work-cover">
        ${coverSrc ? `<img src="${escapeHtml(coverSrc)}" alt="${escapeHtml(w.title)}">` : '作品封面'}
        ${isSignedIn() ? `<button class="work-del" data-delete-work="${w.id}" title="删除">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.6 8.2a1 1 0 001 .9h4a1 1 0 001-.9l.6-8.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>` : ''}
      </div>
      <div class="work-body">
        <span class="${w.category === '视频剪辑' ? 'tag violet' : 'tag'}">${escapeHtml(w.category)}</span>
        <h3 class="work-title">${escapeHtml(w.title)}</h3>
        <p class="work-summary">${escapeHtml(w.summary)}</p>
        <div class="work-meta">${escapeHtml(w.year)}${w.link_url ? ' · 可查看详情' : ''}</div>
      </div>
    </article>`;
  }).join('');
}

function renderPhotos() {
  const grid = $('#photoGrid');
  if (!state.photos.length) {
    grid.innerHTML = '<div class="empty-state">照片墙还是空的。登录后上传第一张照片。</div>';
    return;
  }
  grid.innerHTML = state.photos.map((p) => `
    <div class="photo" data-photo="${p.id}">
      ${p.url ? `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption)}" loading="lazy">` : '<div class="photo-empty">照片</div>'}
      ${p.caption ? `<div class="photo-cap">${escapeHtml(p.caption)}</div>` : ''}
      ${isSignedIn() ? `
        <button class="photo-del" data-delete-photo="${p.id}" title="删除">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.6 8.2a1 1 0 001 .9h4a1 1 0 001-.9l.6-8.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="photo-caption-btn" data-edit-photo="${p.id}" title="加说明">说明</button>` : ''}
    </div>`).join('');
}

/* ============ 弹窗 ============ */

let modalSubmitHandler = null;

/* 随笔阅读弹窗（复用通用弹窗容器，但只读） */
function showEssay(essay) {
  $('#modalTitle').textContent = essay.title;
  $('#modalDesc').textContent = `${formatDate(essay.published_at)} · ${essay.tag}`;
  $('#modalOk').textContent = '关闭';
  $('#modalCancel').style.display = 'none';
  $('#modal').classList.add('modal-read');
  $('#modalFields').innerHTML = `<div class="essay-body">${formatBody(essay.body)}</div>`;
  $('#modalError').classList.remove('show');
  modalSubmitHandler = null;
  $('#modalBackdrop').classList.add('open');
}

/* 极简 Markdown：段落、列表、**加粗**、# 标题 */
function formatBody(text) {
  if (!text) return '';
  const safe = escapeHtml(text);
  const bold = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return safe
    .split(/\n{2,}/)
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (b.startsWith('### ')) return `<h4>${bold(b.slice(4))}</h4>`;
      if (b.startsWith('## ')) return `<h3>${bold(b.slice(3))}</h3>`;
      if (b.startsWith('# ')) return `<h2>${bold(b.slice(2))}</h2>`;
      const lines = b.split('\n');
      if (lines.length > 1 && lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        const items = lines
          .map((l) => `<li>${bold(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${bold(b.replace(/\n/g, '<br>'))}</p>`;
    })
    .join('');
}

/* 弹窗里选好的图片（data URL），保存时随表单一起提交 */
let pendingAvatarData = '';
let pendingCoverData = '';

/* 在弹窗里插一个图片选择器 */
function imageFieldHtml(key, currentData, label) {
  const preview = currentData
    ? `<img src="${currentData}" style="width:100%;height:150px;object-fit:cover;border-radius:14px;border:1px solid #dee2ea">`
    : '<div style="padding:26px 12px;text-align:center;border:1.5px dashed #dee2ea;border-radius:14px;color:#8a8c9e;font-size:13px">还没有选图</div>';
  return `<div class="field">
    <label>${escapeHtml(label)}</label>
    <div id="mf_${key}_preview">${preview}</div>
    <input type="file" id="mf_${key}_file" accept="image/png,image/jpeg,image/webp" hidden>
    <button type="button" class="btn btn-ghost btn-sm" id="mf_${key}_pick" style="margin-top:12px">选择图片</button>
  </div>`;
}

function bindImageField(key, setter) {
  const fileInput = document.getElementById(`mf_${key}_file`);
  const pickBtn = document.getElementById(`mf_${key}_pick`);
  const preview = document.getElementById(`mf_${key}_preview`);
  if (!fileInput || !pickBtn || !preview) return;

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      showModalError('只支持 JPG / PNG / WebP 格式。');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showModalError('图片超过 20MB，请压缩后再传。');
      return;
    }
    pickBtn.disabled = true;
    pickBtn.textContent = '处理中…';
    try {
      const data = await compressImage(file, 1000, 0.85);
      setter(data);
      preview.innerHTML = `<img src="${data}" style="width:100%;height:150px;object-fit:cover;border-radius:14px;border:1px solid #dee2ea">`;
    } catch (e) {
      showModalError('图片处理失败：' + e.message);
    } finally {
      pickBtn.disabled = false;
      pickBtn.textContent = '重新选择';
      fileInput.value = '';
    }
  });
}

function openModal({ title, desc, fields, okText, onSubmit }) {
  $('#modalTitle').textContent = title;
  $('#modalDesc').textContent = desc || '';
  $('#modalDesc').style.display = desc ? '' : 'none';
  $('#modalOk').textContent = okText || '保存';
  $('#modalCancel').style.display = '';
  $('#modal').classList.remove('modal-read');
  $('#modalError').classList.remove('show');

  const fieldsHtml = fields.map((f) => {
    if (f.type === 'textarea') {
      return `<div class="field">
        <label for="mf_${f.key}">${escapeHtml(f.label)}</label>
        <textarea id="mf_${f.key}" data-key="${escapeHtml(f.key)}" rows="${f.rows || 4}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(f.value || '')}</textarea>
      </div>`;
    }
    return `<div class="field">
      <label for="mf_${f.key}">${escapeHtml(f.label)}</label>
      <input id="mf_${f.key}" data-key="${escapeHtml(f.key)}" type="${f.type || 'text'}"
        placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(f.value || '')}">
    </div>`;
  }).join('');

  $('#modalFields').innerHTML = fieldsHtml;
  modalSubmitHandler = onSubmit;
  $('#modalBackdrop').classList.add('open');

  /* 图片选择器绑定 */
  pendingAvatarData = '';
  pendingCoverData = '';
  bindImageField('avatar', (d) => { pendingAvatarData = d; });
  bindImageField('cover', (d) => { pendingCoverData = d; });

  const first = $('#modalFields input:not([type="file"]), #modalFields textarea');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModal() {
  $('#modalBackdrop').classList.remove('open');
  modalSubmitHandler = null;
}

function showModalError(message) {
  const el = $('#modalError');
  el.textContent = message;
  el.classList.add('show');
}

function collectModalValues() {
  const values = {};
  $$('#modalFields [data-key]').forEach((el) => {
    values[el.dataset.key] = el.value.trim();
  });
  return values;
}

/* ============ 写入操作 ============ */

async function saveProfile() {
  const values = collectModalValues();
  if (!values.display_name) {
    showModalError('名字不能为空。');
    return;
  }

  const payload = {
    display_name: values.display_name,
    tagline: values.tagline || '',
    intro: values.intro || '',
    intro_long: values.intro_long || '',
    major: values.major || '',
    city: values.city || '',
    doing: values.doing || '',
    contact: values.contact || '',
    avatar_url: values.avatar_url || '',
    avatar_data: pendingAvatarData || (state.profile ? state.profile.avatar_data : '') || ''
  };

  const existing = state.profile;
  let result;
  if (existing && existing.id) {
    result = await cloud.database
      .from('site_profile')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select();
    const affected = Array.isArray(result.data) ? result.data : [];
    if (affected.length === 0) {
      showModalError('没有改动被保存 —— 可能这不是你的内容，或者需要重新登录。');
      return;
    }
  } else {
    result = await cloud.database
      .from('site_profile')
      .insert({ ...payload, owner_name: state.session?.user?.name ?? null })
      .select();
    if (result.error) {
      showModalError(result.error.message);
      return;
    }
  }
  if (result.error) {
    showModalError(result.error.message);
    return;
  }
  state.profile = result.data && result.data.length ? result.data[0] : existing;
  renderProfile();
  closeModal();
  toast('介绍已更新');
}

async function createEssay(values) {
  if (!values.title) {
    showModalError('标题不能为空。');
    return;
  }
  const { data, error } = await cloud.database
    .from('essays')
    .insert({
      title: values.title,
      excerpt: values.excerpt || '',
      body: values.body || '',
      tag: values.tag || '随笔',
      published_at: new Date().toISOString(),
      owner_name: state.session?.user?.name ?? null
    })
    .select();
  if (error) {
    showModalError(error.message);
    return;
  }
  if (data && data.length) state.essays.unshift(data[0]);
  renderEssays();
  closeModal();
  toast('随笔已发布');
}

async function createWork(values) {
  if (!values.title) {
    showModalError('作品名称不能为空。');
    return;
  }
  const { data, error } = await cloud.database
    .from('works')
    .insert({
      title: values.title,
      category: values.category || '内容策划',
      summary: values.summary || '',
      year: values.year || String(new Date().getFullYear()),
      cover_url: values.cover_url || '',
      cover_data: pendingCoverData || '',
      link_url: values.link_url || '',
      sort_order: state.works.length,
      owner_name: state.session?.user?.name ?? null
    })
    .select();
  if (error) {
    showModalError(error.message);
    return;
  }
  if (data && data.length) state.works.push(data[0]);
  renderWorks();
  closeModal();
  toast('作品已添加');
}

async function saveAllTracks(values) {
  const groups = [
    { num: values.t0_num, title: values.t0_title, description: values.t0_desc },
    { num: values.t1_num, title: values.t1_title, description: values.t1_desc },
    { num: values.t2_num, title: values.t2_title, description: values.t2_desc }
  ];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g.title) continue;
    const existing = state.tracks[i];
    if (existing && existing.id) {
      const { data, error } = await cloud.database
        .from('tracks')
        .update({ num: g.num, title: g.title, description: g.description })
        .eq('id', existing.id)
        .select();
      if (error) {
        showModalError(error.message);
        return;
      }
      if (Array.isArray(data) && data.length) {
        state.tracks[i] = data[0];
      } else {
        showModalError(`第 ${i + 1} 条没有保存成功 —— 可能不属于你。`);
        return;
      }
    } else {
      const { data, error } = await cloud.database
        .from('tracks')
        .insert({
          num: g.num,
          title: g.title,
          description: g.description,
          meta: '',
          sort_order: state.tracks.length,
          owner_name: state.session?.user?.name ?? null
        })
        .select();
      if (error) {
        showModalError(error.message);
        return;
      }
      if (data && data.length) state.tracks.push(data[0]);
    }
  }
  renderProfile();
  closeModal();
  toast('已更新');
}

async function savePhotoCaption(id, caption) {
  const { data, error } = await cloud.database
    .from('photos')
    .update({ caption })
    .eq('id', id)
    .select();
  if (error) {
    showModalError(error.message);
    return;
  }
  const affected = Array.isArray(data) ? data : [];
  if (affected.length === 0) {
    showModalError('没有保存成功 —— 这张照片可能不属于你。');
    return;
  }
  const idx = state.photos.findIndex((p) => String(p.id) === String(id));
  if (idx >= 0) state.photos[idx] = { ...state.photos[idx], caption };
  renderPhotos();
  closeModal();
  toast('说明已更新');
}

async function deleteEssay(id) {
  if (!confirm('确定删除这篇随笔吗？删了就找不回来了。')) return;
  const { data, error } = await cloud.database.from('essays').delete().eq('id', id).select();
  if (error) {
    toast(error.message, true);
    return;
  }
  const removed = Array.isArray(data) ? data : [];
  if (removed.length === 0) {
    toast('没有删除成功 —— 这篇可能不属于你。', true);
    return;
  }
  state.essays = state.essays.filter((e) => e.id !== id);
  renderEssays();
  toast('已删除');
}

async function deleteWork(id) {
  if (!confirm('确定删除这个作品吗？')) return;
  const { data, error } = await cloud.database.from('works').delete().eq('id', id).select();
  if (error) {
    toast(error.message, true);
    return;
  }
  const removed = Array.isArray(data) ? data : [];
  if (removed.length === 0) {
    toast('没有删除成功 —— 这个作品可能不属于你。', true);
    return;
  }
  state.works = state.works.filter((w) => w.id !== id);
  renderWorks();
  toast('已删除');
}

async function deletePhoto(id, imagePath) {
  if (!confirm('确定删除这张照片吗？')) return;
  const { data, error } = await cloud.database.from('photos').delete().eq('id', id).select();
  if (error) {
    toast(error.message, true);
    return;
  }
  const removed = Array.isArray(data) ? data : [];
  if (removed.length === 0) {
    toast('没有删除成功 —— 这张照片可能不属于你。', true);
    return;
  }
  if (imagePath) {
    try {
      await cloud.storage.remove([imagePath]);
    } catch (e) {
      console.warn('[site] storage cleanup failed:', e && e.message);
    }
  }
  state.photos = state.photos.filter((p) => p.id !== id);
  renderPhotos();
  toast('已删除');
}

/* ============ 照片上传 ============ */

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/* 存库版本（压缩后，公开可看）与原图（存云存储，备份） */
const DISPLAY_MAX_EDGE = 1400;
const DISPLAY_QUALITY = 0.82;

async function uploadFiles(fileList) {
  if (!isSignedIn()) {
    toast('请先登录再上传照片。', true);
    await startLogin();
    return;
  }
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const invalid = files.find((f) => !ALLOWED_TYPES.includes(f.type));
  if (invalid) {
    toast('只支持 JPG / PNG / WebP 格式。', true);
    return;
  }
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    toast(`「${tooBig.name}」超过 20MB，请压缩后再传。`, true);
    return;
  }

  const zone = $('#uploadZone');
  zone.classList.add('busy');
  const titleEl = $('.upload-title', zone);
  const originalText = titleEl.textContent;

  try {
    const userId = state.session.user.id;
    let order = state.photos.length;
    let ok = 0;

    for (const file of files) {
      titleEl.textContent = `正在处理 ${ok + 1}/${files.length}…`;

      let displayData;
      try {
        displayData = await compressImage(file, DISPLAY_MAX_EDGE, DISPLAY_QUALITY);
      } catch (e) {
        toast(`「${file.name}」处理失败：${e.message}`, true);
        continue;
      }

      /* 原图备份到云存储（失败不影响发布） */
      let imagePath = '';
      try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = cloud.storage.sharedPath(userId, `photos/${Date.now()}-${order}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
        const uploaded = await cloud.storage.upload(path, file, { contentType: file.type, upsert: false });
        if (!uploaded.error) imagePath = path;
      } catch (e) {
        console.warn('[site] original backup failed:', e && e.message);
      }

      const { data, error } = await cloud.database
        .from('photos')
        .insert({
          image_path: imagePath,
          image_data: displayData,
          caption: '',
          sort_order: order++,
          owner_name: state.session?.user?.name ?? null
        })
        .select();
      if (error) {
        toast(`「${file.name}」保存失败：${error.message}`, true);
        continue;
      }
      if (data && data.length) {
        state.photos.push({ ...data[0], url: data[0].image_data });
        ok++;
      }
    }

    renderPhotos();
    toast(ok ? `已上传 ${ok} 张照片` : '没有照片上传成功');
  } catch (e) {
    console.error('[site] upload failed:', e && e.message);
    toast('上传过程中出错了，请重试。', true);
  } finally {
    zone.classList.remove('busy');
    titleEl.textContent = originalText;
    $('#fileInput').value = '';
  }
}

/* ============ 事件绑定 ============ */

function bindEvents() {
  // 导航
  $('#viewWorksBtn').addEventListener('click', () => { location.hash = '#works'; });

  // 编辑关注方向（一次改三条）
  $('#editTracksBtn').addEventListener('click', async () => {
    if (!isSignedIn()) {
      toast('请先登录再编辑。', true);
      await startLogin();
      return;
    }
    const t0 = state.tracks[0] || {};
    const t1 = state.tracks[1] || {};
    const t2 = state.tracks[2] || {};
    openModal({
      title: '编辑我关注的方向',
      desc: '三条一起改，改完点保存，首页那块同步更新。',
      okText: '保存',
      fields: [
        { key: 't0_num', label: '第一条 · 编号', value: t0.num || '01' },
        { key: 't0_title', label: '第一条 · 名称', value: t0.title || '' },
        { key: 't0_desc', label: '第一条 · 说明', type: 'textarea', value: t0.description || t0.desc || '' },
        { key: 't1_num', label: '第二条 · 编号', value: t1.num || '02' },
        { key: 't1_title', label: '第二条 · 名称', value: t1.title || '' },
        { key: 't1_desc', label: '第二条 · 说明', type: 'textarea', value: t1.description || t1.desc || '' },
        { key: 't2_num', label: '第三条 · 编号', value: t2.num || '03' },
        { key: 't2_title', label: '第三条 · 名称', value: t2.title || '' },
        { key: 't2_desc', label: '第三条 · 说明', type: 'textarea', value: t2.description || t2.desc || '' }
      ],
      onSubmit: saveAllTracks
    });
  });

  // 登录
  $('#loginBtn').addEventListener('click', startLogin);
  $('#contactBtn').addEventListener('click', () => {
    const contact = (state.profile && state.profile.contact) || DEFAULT_PROFILE.contact;
    window.location.href = 'mailto:' + contact;
  });

  // 编辑介绍
  $('#editProfileBtn').addEventListener('click', async () => {
    if (!isSignedIn()) {
      toast('请先登录再编辑。', true);
      await startLogin();
      return;
    }
    const p = state.profile || DEFAULT_PROFILE;
    pendingAvatarData = p.avatar_data || '';
    openModal({
      title: '编辑我的介绍',
      desc: '改完点保存，内容会立刻更新到这个站上。',
      okText: '保存',
      fields: [
        { key: 'display_name', label: '你的名字', value: p.display_name },
        { key: 'tagline', label: '一句话介绍', value: p.tagline, placeholder: '一个正在攒经验的人' },
        { key: 'intro', label: '一句话简介（首页大标题下面那段）', type: 'textarea', rows: 3, value: p.intro, placeholder: '用两三句话讲清楚你是谁、在做什么' },
        { key: 'intro_long', label: '自我介绍正文（页面中间那一段，段落之间空一行）', type: 'textarea', rows: 10, value: p.intro_long, placeholder: '想写多长都行，写你现在的真实状态' },
        { key: 'major', label: '专业', value: p.major },
        { key: 'city', label: '所在地', value: p.city },
        { key: 'doing', label: '在做的事', value: p.doing },
        { key: 'contact', label: '联系方式', value: p.contact }
      ],
      onSubmit: saveProfile
    });
    /* 头像选择器插到表单末尾 */
    const anchor = $('#modalFields');
    anchor.insertAdjacentHTML('beforeend', imageFieldHtml('avatar', p.avatar_data || '', '个人照片'));
    bindImageField('avatar', (d) => { pendingAvatarData = d; });
  });

  // 照片上传
  const fileInput = $('#fileInput');
  $('#chooseFileBtn').addEventListener('click', () => fileInput.click());
  $('#uploadZone').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => uploadFiles(e.target.files));

  const zone = $('#uploadZone');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('drag');
  }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
  });

  // 写随笔
  $('#writeEssayBtn').addEventListener('click', async () => {
    if (!isSignedIn()) {
      toast('请先登录再发布随笔。', true);
      await startLogin();
      return;
    }
    openModal({
      title: '写新随笔',
      desc: '填好标题和摘要就能发布，正文可以之后再补。',
      okText: '发布',
      fields: [
        { key: 'title', label: '标题', value: '', placeholder: '这篇随笔叫什么' },
        { key: 'excerpt', label: '摘要', type: 'textarea', value: '', placeholder: '开头两三句话，概括这篇写了什么' },
        { key: 'tag', label: '分类', value: '教育观察', placeholder: '教育观察 / 读书笔记 / 生活片段' },
        { key: 'body', label: '正文（可留空）', type: 'textarea', value: '', placeholder: '正文内容' }
      ],
      onSubmit: createEssay
    });
  });

  // 添加作品
  $('#addWorkBtn').addEventListener('click', async () => {
    if (!isSignedIn()) {
      toast('请先登录再添加作品。', true);
      await startLogin();
      return;
    }
    openModal({
      title: '添加新作品',
      desc: '填名称和说明就能放上去，封面图可以后补。',
      okText: '添加',
      fields: [
        { key: 'title', label: '作品名称', value: '', placeholder: '写清楚这是什么' },
        { key: 'category', label: '分类', value: '内容策划', placeholder: '内容策划 / 数据整理 / 视频剪辑' },
        { key: 'summary', label: '说明', type: 'textarea', value: '', placeholder: '你做了什么、怎么做的、结果如何' },
        { key: 'year', label: '年份', value: String(new Date().getFullYear()) },
        { key: 'link_url', label: '作品链接（可留空）', value: '', placeholder: 'https://...' }
      ],
      onSubmit: createWork
    });
    const anchor = $('#modalFields');
    anchor.insertAdjacentHTML('beforeend', imageFieldHtml('cover', '', '作品封面'));
    bindImageField('cover', (d) => { pendingCoverData = d; });
  });

  // 弹窗
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', (e) => {
    if (e.target === $('#modalBackdrop')) closeModal();
  });
  $('#modalOk').addEventListener('click', async () => {
    if (!modalSubmitHandler) {
      closeModal();
      return;
    }
    const btn = $('#modalOk');
    btn.disabled = true;
    try {
      await modalSubmitHandler(collectModalValues());
    } catch (e) {
      console.error('[site] modal submit failed:', e && e.message);
      showModalError('保存失败，请重试。');
    } finally {
      btn.disabled = false;
    }
  });

  // 照片查看
  $('#lightboxClose').addEventListener('click', () => $('#lightboxBackdrop').classList.remove('open'));
  $('#lightboxBackdrop').addEventListener('click', (e) => {
    if (e.target === $('#lightboxBackdrop')) $('#lightboxBackdrop').classList.remove('open');
  });

  // 列表里的删除按钮（事件委托）
  document.addEventListener('click', (e) => {
    const editTrack = e.target.closest('[data-edit-track]');
    if (editTrack) {
      e.stopPropagation();
      const idx = editTrack.dataset.editTrack;
      $('#editTracksBtn').dataset.index = idx;
      $('#editTracksBtn').click();
      return;
    }
    const delEssay = e.target.closest('[data-delete-essay]');
    if (delEssay) { e.stopPropagation(); deleteEssay(delEssay.dataset.deleteEssay); return; }
    const delWork = e.target.closest('[data-delete-work]');
    if (delWork) { e.stopPropagation(); deleteWork(delWork.dataset.deleteWork); return; }
    const delPhoto = e.target.closest('[data-delete-photo]');
    if (delPhoto) {
      e.stopPropagation();
      const row = state.photos.find((p) => String(p.id) === delPhoto.dataset.deletePhoto);
      deletePhoto(delPhoto.dataset.deletePhoto, row && row.image_path);
      return;
    }
    const editPhoto = e.target.closest('[data-edit-photo]');
    if (editPhoto) {
      e.stopPropagation();
      const row = state.photos.find((p) => String(p.id) === editPhoto.dataset.editPhoto);
      openModal({
        title: '给这张照片加一句说明',
        desc: '写点当时的想法，以后回看会很有意思。',
        okText: '保存',
        fields: [
          { key: 'caption', label: '说明', type: 'textarea', value: (row && row.caption) || '', placeholder: '这张照片是什么' }
        ],
        onSubmit: (values) => savePhotoCaption(editPhoto.dataset.editPhoto, values.caption)
      });
      return;
    }
    const readEssay = e.target.closest('[data-read-essay]');
    if (readEssay) {
      e.stopPropagation();
      const row = state.essays.find((x) => String(x.id) === readEssay.dataset.readEssay);
      if (row) showEssay(row);
      return;
    }
    const photo = e.target.closest('[data-photo]');
    if (photo) {
      const row = state.photos.find((p) => String(p.id) === photo.dataset.photo);
      if (row && row.url) {
        $('#lightboxImg').src = row.url;
        $('#lightboxCap').textContent = row.caption || '';
        $('#lightboxBackdrop').classList.add('open');
      }
    }
  });
}

/* ============ 启动 ============ */

async function boot() {
  handleHash();
  bindEvents();
  state.tracks = DEFAULT_TRACKS;

  await restoreAuth();

  /* 登录后接管示例内容，让它归本人所有 */
  if (isSignedIn()) {
    await claimSeedContent();
  }

  const [profile, essays, works, photos, tracks] = await Promise.all([
    loadProfile(), loadEssays(), loadWorks(), loadPhotos(), loadTracks()
  ]);
  state.profile = profile;
  state.essays = essays;
  state.works = works;
  state.photos = await resolvePhotoUrls(photos);
  state.tracks = tracks.length ? tracks : DEFAULT_TRACKS;

  renderProfile();
  renderEssays();
  renderWorks();
  renderPhotos();
  syncAuthUI();
}

boot();
