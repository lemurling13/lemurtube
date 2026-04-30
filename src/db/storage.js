// Simple localStorage wrappers

export const SettingsStore = {
  getBuckets() {
    let parsed = [];
    try {
      const data = localStorage.getItem('lemur_buckets');
      if (data) parsed = JSON.parse(data);
    } catch (e) {
      console.error(e);
    }
    
    // Default fallback if totally empty
    if (!parsed || parsed.length === 0) {
      parsed = [{
          id: `bucket_1`,
          name: 'Default Bucket',
          sources: [
            { id: 'UCBJycsmduvYEL83R_U4JriQ', keywords: '', shortsConstraint: 'mix', recency: 'all', priority: 'medium' }
          ], 
          keywords: '',
          shortsConstraint: 'max_3'
      }];
    }

    // Migration Block: Convert old V2 string sources to V3 object arrays
    parsed = parsed.map(b => {
      if (typeof b.sources === 'string') {
         const list = b.sources.split(',').map(s => s.trim()).filter(s => s);
         b.sources = list.map(sourceId => ({
            id: sourceId,
            keywords: '',
            shortsConstraint: 'mix',
            recency: 'all',
            priority: 'medium'
         }));
      }
      return b;
    });

    return parsed;
  },

  setBuckets(bucketsObj) {
    localStorage.setItem('lemur_buckets', JSON.stringify(bucketsObj));
  },

  getActiveBucketId() {
    const id = localStorage.getItem('lemur_active_bucket');
    const buckets = this.getBuckets();
    if (id && buckets.some(b => b.id === id)) return id;
    return buckets.length > 0 ? buckets[0].id : null;
  },

  setActiveBucketId(id) {
    localStorage.setItem('lemur_active_bucket', id);
  },

  getAutoplay() {
    return localStorage.getItem('lemur_autoplay') !== 'false';
  },

  setAutoplay(val) {
    localStorage.setItem('lemur_autoplay', val ? 'true' : 'false');
  },

  getQueueExpanded() {
    return localStorage.getItem('lemur_queue_expanded') !== 'false';
  },

  setQueueExpanded(val) {
    localStorage.setItem('lemur_queue_expanded', val ? 'true' : 'false');
  },

  saveQueueState(bucketId, queueArray) {
     localStorage.setItem(`lemur_queue_${bucketId}`, JSON.stringify(queueArray || []));
  },

  loadQueueState(bucketId) {
     const raw = localStorage.getItem(`lemur_queue_${bucketId}`);
     if (!raw) return [];
     try { return JSON.parse(raw); } catch { return []; }
  },

  savePlaybackState(videoId, timeSec) {
     localStorage.setItem('lemur_playback_state', JSON.stringify({ videoId, timeSec }));
  },

  getPlaybackState() {
     const raw = localStorage.getItem('lemur_playback_state');
     if (!raw) return null;
     try { return JSON.parse(raw); } catch { return null; }
  },

  getYoutubeApiKey() {
    return localStorage.getItem('lemur_youtube_api_key') || '';
  },

  setYoutubeApiKey(key) {
    localStorage.setItem('lemur_youtube_api_key', key);
  }
};


export const HistoryStore = {
  dbName: 'LemurTubeHistory',
  version: 3,
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("IndexedDB connection timed out. Close other tabs running LemurTube."));
      }, 3000);

      const req = indexedDB.open(this.dbName, this.version);
      
      req.onblocked = () => {
        clearTimeout(timeout);
        reject(new Error("IndexedDB is blocked by another tab. Please close duplicates!"));
      };

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('watched')) {
          db.createObjectStore('watched', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('dismissed')) {
          db.createObjectStore('dismissed', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('saved')) {
          db.createObjectStore('saved', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('source_pools')) {
          db.createObjectStore('source_pools', { keyPath: 'sourceId' });
        }
      };

      
      req.onsuccess = () => {
        clearTimeout(timeout);
        this.db = req.result;
        
        // Handle unexpected disconnects cleanly
        this.db.onversionchange = () => {
           this.db.close();
        };
        
        resolve();
      };
      
      req.onerror = () => {
        clearTimeout(timeout);
        reject(req.error);
      };
    });
  },

  async markWatched(video) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('watched', 'readwrite');
      tx.objectStore('watched').put({ 
         id: video.id, 
         title: video.title, 
         channelTitle: video.channelTitle, 
         thumbnail: video.thumbnail, 
         durationSec: video.durationSec,
         timestamp: Date.now() 
      });
      tx.oncomplete = () => resolve();
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
    });

  },

  async isWatched(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('watched', 'readonly');
      const req = tx.objectStore('watched').get(id);
      req.onsuccess = () => resolve(!!req.result);
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
      tx.onerror = (e) => reject(e.target.error || "Transaction failed");
    });
  },

  async markDismissed(video) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('dismissed', 'readwrite');
      tx.objectStore('dismissed').put({ 
         id: video.id, 
         title: video.title, 
         channelTitle: video.channelTitle, 
         thumbnail: video.thumbnail, 
         durationSec: video.durationSec,
         timestamp: Date.now() 
      });
      tx.oncomplete = () => resolve();
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
      tx.onerror = (e) => reject(e.target.error || "Transaction failed");
    });
  },

  async isDismissed(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('dismissed', 'readonly');
      const req = tx.objectStore('dismissed').get(id);
      req.onsuccess = () => resolve(!!req.result);
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
      tx.onerror = (e) => reject(e.target.error || "Transaction failed");
    });
  },

  async markSaved(video) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('saved', 'readwrite');
      tx.objectStore('saved').put({ 
         id: video.id, 
         title: video.title, 
         channelTitle: video.channelTitle, 
         thumbnail: video.thumbnail, 
         durationSec: video.durationSec,
         timestamp: Date.now() 
      });
      tx.oncomplete = () => resolve();
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
    });

  },

  async getAllStore(storeName) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error || "getAllStore failed");
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
    });
  },


  async removeFromStore(storeName, id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      console.log(`[Diagnostic Trace] Physically deleting habit key ${id} from store ${storeName}`);
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
    });
  },

  async getPool(sourceId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('source_pools', 'readonly');
      const req = tx.objectStore('source_pools').get(sourceId);
      req.onsuccess = () => resolve(req.result || { sourceId, ids: [], nextPageToken: '' });
      req.onerror = (e) => reject(e.target.error || "getPool failed");
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
    });
  },

  async savePool(sourceId, data) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('source_pools', 'readwrite');
      tx.objectStore('source_pools').put({ sourceId, ...data });
      tx.oncomplete = () => resolve();
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
      tx.onerror = (e) => reject(e.target.error || "Transaction failed");
    });
  },

  async clearPool(sourceId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('source_pools', 'readwrite');
      tx.objectStore('source_pools').delete(sourceId);
      tx.oncomplete = () => resolve();
      tx.onabort = (e) => reject(e.target.error || "Transaction aborted");
    });
  }

};
