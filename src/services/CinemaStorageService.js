import AsyncStorage from '@react-native-async-storage/async-storage';

const RESUME_STORAGE_KEY = '@universal_remote_cinema_resume_v1';
const QUEUE_STORAGE_KEY = '@universal_remote_cinema_queue_v1';
const SUB_STYLE_STORAGE_KEY = '@universal_remote_sub_style_v1';

const MAX_RESUME_ITEMS = 30;
const MIN_RESUME_SEC = 10;

export const DEFAULT_SUBTITLE_STYLE = {
  fontSize: 34,
  color: '#FFFFFF',
  bgOpacity: 0.45,
  verticalOffset: 8,
  offsetSec: 0,
};

export function formatSecondsHms(rawSec) {
  const total = Math.max(0, Math.floor(Number(rawSec) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function normalizeMediaKey(rawUrl) {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  try {
    const hashIdx = clean.indexOf('#');
    const noHash = hashIdx >= 0 ? clean.slice(0, hashIdx) : clean;
    return noHash;
  } catch (_) {
    return clean;
  }
}

async function readJsonArray(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function writeJsonValue(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // ignore storage errors
  }
}

class CinemaStorageService {
  async getResumeList() {
    const list = await readJsonArray(RESUME_STORAGE_KEY);
    return list
      .filter((item) => item && item.url)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      .slice(0, MAX_RESUME_ITEMS);
  }

  async findResumeForUrl(rawUrl) {
    const key = normalizeMediaKey(rawUrl);
    if (!key) return null;
    const list = await this.getResumeList();
    const match = list.find(
      (item) => normalizeMediaKey(item.url) === key && (Number(item.positionSec) || 0) >= MIN_RESUME_SEC
    );
    return match || null;
  }

  async savePlaybackProgress(entry) {
    if (!entry || !entry.url) return [];
    const key = normalizeMediaKey(entry.url);
    if (!key) return [];
    const positionSec = Math.max(0, Math.floor(Number(entry.positionSec) || 0));
    const durationSec = Math.max(0, Math.floor(Number(entry.durationSec) || 0));

    const existing = await this.getResumeList();

    // إذا انتهى الفيديو بنسبة >= 96% أزله من قائمة الاستكمال
    if (durationSec > 30 && positionSec / durationSec >= 0.96) {
      const filtered = existing.filter((item) => normalizeMediaKey(item.url) !== key);
      await writeJsonValue(RESUME_STORAGE_KEY, filtered);
      return filtered;
    }

    if (positionSec < 5) {
      return existing;
    }

    const prevItem = existing.find((item) => normalizeMediaKey(item.url) === key);
    const nextRecord = {
      id: prevItem ? prevItem.id : `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      url: String(entry.url).trim(),
      title: String(entry.title || (prevItem && prevItem.title) || 'فيديو محفوظ').trim(),
      mimeType: String(entry.mimeType || (prevItem && prevItem.mimeType) || 'video/mp4').trim(),
      headers:
        entry.headers && typeof entry.headers === 'object'
          ? entry.headers
          : (prevItem && prevItem.headers) || {},
      subtitleUrl:
        entry.subtitleUrl !== undefined
          ? entry.subtitleUrl || ''
          : (prevItem && prevItem.subtitleUrl) || '',
      subtitleName:
        entry.subtitleName !== undefined
          ? entry.subtitleName || ''
          : (prevItem && prevItem.subtitleName) || '',
      subtitleOffsetMs:
        entry.subtitleOffsetMs !== undefined
          ? Math.round(Number(entry.subtitleOffsetMs) || 0)
          : (prevItem && prevItem.subtitleOffsetMs) || 0,
      positionSec,
      durationSec: durationSec || (prevItem && prevItem.durationSec) || 0,
      updatedAt: Date.now(),
    };

    const nextList = [
      nextRecord,
      ...existing.filter((item) => normalizeMediaKey(item.url) !== key),
    ].slice(0, MAX_RESUME_ITEMS);

    await writeJsonValue(RESUME_STORAGE_KEY, nextList);
    return nextList;
  }

  async removeResumeItem(idOrUrl) {
    const target = String(idOrUrl || '').trim();
    if (!target) return this.getResumeList();
    const list = await this.getResumeList();
    const next = list.filter(
      (item) => item.id !== target && normalizeMediaKey(item.url) !== normalizeMediaKey(target)
    );
    await writeJsonValue(RESUME_STORAGE_KEY, next);
    return next;
  }

  async clearResumeList() {
    await writeJsonValue(RESUME_STORAGE_KEY, []);
    return [];
  }

  async getQueue() {
    const list = await readJsonArray(QUEUE_STORAGE_KEY);
    return list.filter((item) => item && item.url);
  }

  async enqueueEpisode(item) {
    if (!item || !item.url) return this.getQueue();
    const cleanUrl = String(item.url).trim();
    const existing = await this.getQueue();
    const nextItem = {
      queueId: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      url: cleanUrl,
      title: String(item.title || 'حلقة / فيديو').trim(),
      mimeType: String(item.mimeType || 'video/mp4').trim(),
      headers: item.headers && typeof item.headers === 'object' ? item.headers : {},
      subtitleUrl: item.subtitleUrl ? String(item.subtitleUrl).trim() : '',
      subtitleName: item.subtitleName ? String(item.subtitleName).trim() : '',
      addedAt: Date.now(),
    };

    // تجنب تكرار نفس الرابط مباشرة إذا كان موجوداً بنفس الموضع
    const filtered = existing.filter((q) => normalizeMediaKey(q.url) !== normalizeMediaKey(cleanUrl));
    const nextQueue = [...filtered, nextItem];
    await writeJsonValue(QUEUE_STORAGE_KEY, nextQueue);
    return nextQueue;
  }

  async removeFromQueue(queueId) {
    const list = await this.getQueue();
    const next = list.filter((item) => item.queueId !== queueId);
    await writeJsonValue(QUEUE_STORAGE_KEY, next);
    return next;
  }

  async shiftQueueNext() {
    const list = await this.getQueue();
    if (list.length === 0) {
      return { nextItem: null, queue: [] };
    }
    const [nextItem, ...rest] = list;
    await writeJsonValue(QUEUE_STORAGE_KEY, rest);
    return { nextItem, queue: rest };
  }

  async clearQueue() {
    await writeJsonValue(QUEUE_STORAGE_KEY, []);
    return [];
  }

  async getSubtitleStyle() {
    try {
      const raw = await AsyncStorage.getItem(SUB_STYLE_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SUBTITLE_STYLE };
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SUBTITLE_STYLE,
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      };
    } catch (_) {
      return { ...DEFAULT_SUBTITLE_STYLE };
    }
  }

  async saveSubtitleStyle(partialOrFullStyle) {
    const current = await this.getSubtitleStyle();
    const merged = {
      ...current,
      ...(partialOrFullStyle && typeof partialOrFullStyle === 'object' ? partialOrFullStyle : {}),
    };
    merged.fontSize = Math.max(18, Math.min(56, Math.round(Number(merged.fontSize) || 34)));
    merged.bgOpacity = Math.max(0, Math.min(0.95, Number(merged.bgOpacity) || 0));
    merged.verticalOffset = Math.max(2, Math.min(30, Math.round(Number(merged.verticalOffset) || 8)));
    merged.offsetSec = Math.max(-120, Math.min(120, Number((Number(merged.offsetSec) || 0).toFixed(1))));
    merged.color = merged.color === '#FACC15' ? '#FACC15' : '#FFFFFF';
    await writeJsonValue(SUB_STYLE_STORAGE_KEY, merged);
    return merged;
  }
}

export default new CinemaStorageService();
