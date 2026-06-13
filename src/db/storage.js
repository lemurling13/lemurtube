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
    let migrated = false;
    parsed = parsed.map(b => {
      if (typeof b.sources === 'string') {
         const list = b.sources.split(',').map(s => s.trim()).filter(s => s);
         b.sources = list.map(sourceId => ({
            instanceId: 'src_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36),
            id: sourceId,
            keywords: '',
            shortsConstraint: 'mix',
            recency: 'all',
            priority: 'medium'
         }));
         migrated = true;
      } else if (b.sources && Array.isArray(b.sources)) {
         b.sources = b.sources.map(s => {
            if (!s.instanceId) {
               s.instanceId = 'src_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
               migrated = true;
            }
            return s;
         });
      }
      return b;
    });

    if (migrated) {
       localStorage.setItem('lemur_buckets', JSON.stringify(parsed));
    }

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
  },

  getTheme() {
    return localStorage.getItem('lemur_theme') || 'dark';
  },

  setTheme(theme) {
    localStorage.setItem('lemur_theme', theme);
  }
};


export const HistoryStore = {
  dbName: 'LemurTubeHistory',
  version: 3,
  db: null,
  initPromise: null,
  cachedWatched: null,
  cachedDismissed: null,

  async init() {
    if (this.db) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.initPromise = null;
        reject(new Error("IndexedDB connection timed out. Close other tabs running LemurTube."));
      }, 3000);

      const req = indexedDB.open(this.dbName, this.version);
      
      req.onblocked = () => {
        clearTimeout(timeout);
        this.initPromise = null;
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
        const tempDb = req.result;
        
        tempDb.onversionchange = () => {
           tempDb.close();
           if (this.db === tempDb) {
              this.db = null;
           }
           this.initPromise = null;
        };

        let loadedCount = 0;
        const checkComplete = () => {
          loadedCount++;
          if (loadedCount === 3) {
            this.db = tempDb;
            resolve();
          }
        };

        try {
          const wTx = tempDb.transaction('watched', 'readonly');
          const wReq = wTx.objectStore('watched').getAllKeys();
          wReq.onsuccess = () => {
            this.cachedWatched = new Set(wReq.result || []);
            checkComplete();
          };
          wReq.onerror = () => {
            this.cachedWatched = new Set();
            checkComplete();
          };
          
          const dTx = tempDb.transaction('dismissed', 'readonly');
          const dReq = dTx.objectStore('dismissed').getAllKeys();
          dReq.onsuccess = () => {
            this.cachedDismissed = new Set(dReq.result || []);
            checkComplete();
          };
          dReq.onerror = () => {
            this.cachedDismissed = new Set();
            checkComplete();
          };

          const sTx = tempDb.transaction('saved', 'readonly');
          const sReq = sTx.objectStore('saved').getAllKeys();
          sReq.onsuccess = () => {
            this.cachedSaved = new Set(sReq.result || []);
            checkComplete();
          };
          sReq.onerror = () => {
            this.cachedSaved = new Set();
            checkComplete();
          };
        } catch (err) {
          console.error("Cache preload error:", err);
          this.cachedWatched = new Set();
          this.cachedDismissed = new Set();
          this.cachedSaved = new Set();
          this.db = tempDb;
          resolve();
        }
      };
      
      req.onerror = () => {
        clearTimeout(timeout);
        this.initPromise = null;
        reject(req.error);
      };
    });

    return this.initPromise;
  },

  async markWatched(video) {
    if (!video) return;
    const item = typeof video === 'string' ? { id: video, timestamp: Date.now() } : video;
    if (!item.id) return;
    if (!this.db) await this.init();
    if (this.cachedWatched) this.cachedWatched.add(item.id);
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('watched', 'readwrite');
        tx.objectStore('watched').put({ 
           id: item.id, 
           title: item.title || '', 
           channelId: item.channelId || '',
           channelTitle: item.channelTitle || '', 
           thumbnail: item.thumbnail || '', 
           durationSec: item.durationSec || 0,
           timestamp: item.timestamp || Date.now() 
        });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || "Transaction failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async isWatched(id) {
    if (!id) return false;
    if (!this.db) await this.init();
    if (this.cachedWatched && this.cachedWatched.has(id)) return true;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('watched', 'readonly');
        const req = tx.objectStore('watched').get(id);
        req.onsuccess = () => {
          if (req.result && this.cachedWatched) this.cachedWatched.add(id);
          resolve(!!req.result);
        };
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async markDismissed(video) {
    if (!video) return;
    const item = typeof video === 'string' ? { id: video, timestamp: Date.now() } : video;
    if (!item.id) return;
    if (!this.db) await this.init();
    if (this.cachedDismissed) this.cachedDismissed.add(item.id);
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('dismissed', 'readwrite');
        tx.objectStore('dismissed').put({ 
           id: item.id, 
           title: item.title || '', 
           channelId: item.channelId || '',
           channelTitle: item.channelTitle || '', 
           thumbnail: item.thumbnail || '', 
           durationSec: item.durationSec || 0,
           timestamp: item.timestamp || Date.now() 
        });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || "Transaction failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async isDismissed(id) {
    if (!id) return false;
    if (!this.db) await this.init();
    if (this.cachedDismissed && this.cachedDismissed.has(id)) return true;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('dismissed', 'readonly');
        const req = tx.objectStore('dismissed').get(id);
        req.onsuccess = () => {
          if (req.result && this.cachedDismissed) this.cachedDismissed.add(id);
          resolve(!!req.result);
        };
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async isSaved(id) {
    if (!id) return false;
    if (!this.db) await this.init();
    if (this.cachedSaved && this.cachedSaved.has(id)) return true;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('saved', 'readonly');
        const req = tx.objectStore('saved').get(id);
        req.onsuccess = () => {
          if (req.result && this.cachedSaved) this.cachedSaved.add(id);
          resolve(!!req.result);
        };
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async markSaved(video) {
    if (!video) return;
    const item = typeof video === 'string' ? { id: video, timestamp: Date.now() } : video;
    if (!item.id) return;
    if (!this.db) await this.init();
    if (this.cachedSaved) this.cachedSaved.add(item.id);
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('saved', 'readwrite');
        tx.objectStore('saved').put({ 
           id: item.id, 
           title: item.title || '', 
           channelTitle: item.channelTitle || '', 
           thumbnail: item.thumbnail || '', 
           durationSec: item.durationSec || 0,
           timestamp: item.timestamp || Date.now() 
        });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || "Transaction failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async getAllStore(storeName) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error || "getAllStore failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async removeFromStore(storeName, id) {
    if (!this.db) await this.init();
    if (storeName === 'watched' && this.cachedWatched) this.cachedWatched.delete(id);
    if (storeName === 'dismissed' && this.cachedDismissed) this.cachedDismissed.delete(id);
    if (storeName === 'saved' && this.cachedSaved) this.cachedSaved.delete(id);
    return new Promise((resolve, reject) => {
      try {
        console.log(`[Diagnostic Trace] Physically deleting habit key ${id} from store ${storeName}`);
        const tx = this.db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || "Transaction failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async getPool(sourceId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('source_pools', 'readonly');
        const req = tx.objectStore('source_pools').get(sourceId);
        req.onsuccess = () => resolve(req.result || { sourceId, ids: [], nextPageToken: '' });
        req.onerror = (e) => reject(e.target.error || "getPool failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async savePool(sourceId, data) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('source_pools', 'readwrite');
        tx.objectStore('source_pools').put({ sourceId, ...data });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || "Transaction failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async clearPool(sourceId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('source_pools', 'readwrite');
        tx.objectStore('source_pools').delete(sourceId);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || "Transaction failed");
      } catch (e) {
        reject(e);
      }
    });
  },

  async resetSourceHistory(sourceId, channelTitle) {
    if (!this.db) await this.init();
    
    // Clear pool
    await this.clearPool(sourceId);
    
    const cleanStore = async (storeName) => {
      const allItems = await this.getAllStore(storeName);
      const toRemove = allItems.filter(item => {
        return (item.channelId && item.channelId === sourceId) || 
               (item.channelTitle && channelTitle && item.channelTitle.toLowerCase() === channelTitle.toLowerCase());
      });
      
      for (const item of toRemove) {
        await this.removeFromStore(storeName, item.id);
      }
    };
    
    await cleanStore('watched');
    await cleanStore('dismissed');
  }
};
