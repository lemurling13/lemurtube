import { QueueEngine } from '../logic/queueEngine.js';
import { SettingsStore, HistoryStore } from '../db/storage.js';
import { YouTubeApi } from '../api/youtube.js';

export const QueueDrawer = {
  listEl: null,
  playVideoCallback: null,
  filterState: 'all',

  matchesFilter(video) {
    if (this.filterState === 'shorts') return video.isShort;
    if (this.filterState === 'no_shorts') return !video.isShort;
    return true;
  },

  init(playVideoCallback) {
    this.listEl = document.getElementById('queue-list');
    this.playVideoCallback = playVideoCallback;

    document.getElementById('btn-fetch-bottom').addEventListener('click', () => this.fetchVideos(false));
    
    const filterBtn = document.getElementById('btn-fetch-top');
    filterBtn.addEventListener('click', () => {
        if (this.filterState === 'all') {
            this.filterState = 'shorts';
            filterBtn.innerHTML = 'Shorts';
        } else if (this.filterState === 'shorts') {
            this.filterState = 'no_shorts';
            filterBtn.innerHTML = 'No Shorts';
        } else {
            this.filterState = 'all';
            filterBtn.innerHTML = 'All';
        }
        this.render();
    });

    const replaceAllBtn = document.getElementById('btn-replace-all');
    replaceAllBtn.addEventListener('click', () => {
      QueueEngine.clearQueue();
      this.fetchVideos(false, replaceAllBtn);
    });


    document.querySelectorAll('.btn-timed').forEach(btn => {
      btn.addEventListener('click', (e) => {
         const mins = parseInt(e.target.getAttribute('data-mins'), 10);
         this.generateTimedStream(mins);
      });
    });

    const drawer = document.getElementById('queue-drawer');
    const toggleBtn = document.getElementById('btn-toggle-queue');
    const headerEl = document.getElementById('queue-drawer-handle');
    
    // Initial State Check
    if (!SettingsStore.getQueueExpanded()) {
        drawer.classList.add('collapsed');
    }
    
    const toggleDrawer = () => {
        if (drawer.classList.contains('collapsed')) {
             drawer.classList.remove('collapsed');
             SettingsStore.setQueueExpanded(true);
        } else {
             drawer.classList.add('collapsed');
             SettingsStore.setQueueExpanded(false);
        }
    };
    
    toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer(); });
    headerEl.addEventListener('click', toggleDrawer);
    
    // Add skip next listener
    document.getElementById('btn-skip-next').addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent toggling the drawer
        const activeIdx = QueueEngine.getActiveIndex();
        const queue = QueueEngine.getQueue();
        
        if (queue.length > 0 && activeIdx < queue.length) {
            const video = queue[activeIdx];
            queue.splice(activeIdx, 1);
            await HistoryStore.markDismissed(video);
            
            QueueEngine.setQueue(queue); // update immediately
            this.render(); // redraw UI
            
            // Re-fetch remaining queue length for edge case check
            const newLen = QueueEngine.getQueue().length;
            
            if (activeIdx < newLen) {
                // Next video organically shifted into activeIdx
                this.playVideoCallback(queue[activeIdx], SettingsStore.getAutoplay());
            } else if (newLen > 0) {
                // We reached the absolute bottom of the list, loop back to top
                QueueEngine.setActiveIndex(0);
                this.playVideoCallback(queue[0], SettingsStore.getAutoplay());
            } else {
                // We deleted the very last video and the list is now totally empty
                document.getElementById('youtube-player').innerHTML = ''; // Clear video
            }
        }
    });
    
    // Bind Bucket Selector
    const selector = document.getElementById('bucket-selector');
    selector.addEventListener('change', (e) => {
       SettingsStore.setActiveBucketId(e.target.value);
       QueueEngine.setQueue(SettingsStore.loadQueueState(e.target.value));
       this.render();
       
       if (QueueEngine.getQueue().length > 0) {
           this.playVideoCallback(QueueEngine.getQueue()[0], false); // Just spool
       } else {
           document.getElementById('youtube-player').innerHTML = '';
       }
    });
    
    // Initial Load - Pull from persistent storage
    const activeId = SettingsStore.getActiveBucketId() || 'default';
    QueueEngine.setQueue(SettingsStore.loadQueueState(activeId));
    this.render();
    
    if (QueueEngine.getQueue().length > 0) {
       this.playVideoCallback(QueueEngine.getQueue()[0], false); // Just spool
    }
  },

  render() {
    this.listEl.innerHTML = '';
    const queue = QueueEngine.getQueue();
    
    // Always persist state to storage when render is called
    SettingsStore.saveQueueState(SettingsStore.getActiveBucketId() || 'default', queue);
    this.renderPreview(queue);

    if (queue.length === 0) {
      this.listEl.innerHTML = '<div class="empty-state">Queue is empty. Select a bucket and fetch to begin.</div>';
      return;
    }

    queue.forEach((video, index) => {
      const activeIdx = QueueEngine.getActiveIndex();
      const isActive = index === activeIdx;

      const el = document.createElement('div');
      el.className = 'queue-item' + (isActive ? ' current-playing' : '') + (video.isTimedBlock ? ' timed-block-item' : '');
      el.style.cursor = 'pointer';
      
      if (!this.matchesFilter(video)) {
          el.style.display = 'none';
      }


      const timedTag = video.isTimedBlock ? `<span style="background:var(--primary-accent);color:#fff;padding:2px 4px;font-size:0.7rem;border-radius:2px;margin-right:4px;">⏱️ Timed</span>` : '';
      
      el.innerHTML = `
        <img src="${video.thumbnail}" alt="thumb" class="video-thumb">
        <div class="video-info">
          <div class="video-title">${timedTag}${video.title}</div>
          <div class="video-meta">${video.channelTitle} • ${video.isShort ? 'Short' : this.formatTime(video.durationSec)}</div>
        </div>
        ${isActive ? '<div class="playing-indicator"><svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:var(--primary-accent);"><path d="M8 5v14l11-7z"/></svg></div>' : ''}
        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
            <button class="save-btn" data-id="${video.id}" style="padding:4px 8px; font-size:0.8rem; background:transparent; border:1px solid var(--primary-accent); border-radius:4px; color:var(--primary-accent); cursor:pointer;">🤍 Save</button>
            <button class="dismiss-btn" data-id="${video.id}">Dismiss</button>
        </div>
      `;

      el.querySelector('.save-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          await HistoryStore.markSaved(video);
          e.target.innerHTML = '❤️ Saved';
          e.target.style.background = 'var(--primary-accent)';
          e.target.style.color = '#fff';
      });

      el.querySelector('.dismiss-btn').addEventListener('click', async (e) => {
        e.stopPropagation(); 
        
        let targetAction = 'dismissed';
        if (isActive && window.player && typeof window.player.getCurrentTime === 'function') {
           const time = window.player.getCurrentTime();
           const duration = window.player.getDuration();
           if (duration > 0 && (time / duration) >= 0.90) {
              targetAction = 'watched';
              console.log(`[Diagnostic] Video >90% complete. Re-routing Dismissal to Watched status.`);
           }
        }
        
        QueueEngine.queue.splice(index, 1);
        
        // Adjust active index
        let curActive = QueueEngine.getActiveIndex();
        if (index < curActive) {
            QueueEngine.setActiveIndex(curActive - 1);
        }
        
        if (targetAction === 'watched') await HistoryStore.markWatched(video);
        else await HistoryStore.markDismissed(video);
        
        this.render();
        
        // If we dismissed the currently loaded/playing video, load the next one
        if (isActive) {
            let nextActive = QueueEngine.getActiveIndex(); // It's now the item that shifted UP to `index` position
            if (nextActive < QueueEngine.queue.length) {
                this.playVideoCallback(QueueEngine.queue[nextActive], SettingsStore.getAutoplay());
            } else if (QueueEngine.queue.length > 0) {
                // we exhausted the list, loop back
                QueueEngine.setActiveIndex(0);
                this.playVideoCallback(QueueEngine.queue[0], SettingsStore.getAutoplay());
            } else {
                document.getElementById('youtube-player').innerHTML = ''; // Clear player
            }
        }
      });

      // Allow clicking ANY video row to force-play it immediately
      el.addEventListener('click', () => {
         QueueEngine.setActiveIndex(index);
         this.render();
         this.playVideoCallback(QueueEngine.queue[index], true);
      });

      this.listEl.appendChild(el);
    });
  },
  
  renderPreview(queue) {
      const previewEl = document.getElementById('queue-next-preview');
      const activeIdx = QueueEngine.getActiveIndex();
      
      if (queue.length === 0) {
          previewEl.textContent = 'Empty Window';
      } else if (activeIdx + 1 < queue.length) {
          const nextVid = queue[activeIdx + 1];
          previewEl.textContent = `${nextVid.channelTitle} - ${nextVid.title}`;
      } else {
          previewEl.textContent = 'End of Queue';
      }
  },

  async fetchVideos(toTop = false, triggeringBtn = null) {
    const activeId = SettingsStore.getActiveBucketId();
    const buckets = SettingsStore.getBuckets();
    const activeBucket = buckets.find(b => b.id === activeId);
    
    if (!activeBucket || !activeBucket.sources || activeBucket.sources.length === 0) {
      alert("Please configure sources for your active bucket in Settings first.");
      return;
    }

    const btn = triggeringBtn || (toTop ? document.getElementById('btn-fetch-top') : document.getElementById('btn-fetch-bottom'));
    const oldHtml = btn.innerHTML;
    btn.innerHTML = 'Fetching...';
    btn.disabled = true;


    try {
      // Pull from local pools instead of API
      const fetchPromises = activeBucket.sources.map(async (src) => {
          if (!src.id || src.id.trim().length < 5) {
              console.log(`[Diagnostic] Skipping empty or invalid source ID in fetch: "${src.id}"`);
              return { src, rawVideos: [] };
          }
          const pool = await HistoryStore.getPool(src.id);
          // Take top 10 candidates to keep lottery pool balanced
          const candidates = pool.ids.slice(0, 10).map(id => ({ id }));
          return { src, rawVideos: candidates };
      });



      const allFetchedData = await Promise.all(fetchPromises);
      let globalEnrichedPool = [];

      for (const data of allFetchedData) {
           if (data.rawVideos.length > 0) {
                const enrichedForSource = await QueueEngine.filterAndEnrichVideos(data.rawVideos, activeBucket, data.src);
                globalEnrichedPool = globalEnrichedPool.concat(enrichedForSource.map(v => ({...v, sourcePriority: data.src.priority, sourceId: data.src.id})));
           }
      }

      // Shuffle entire valid pool to prevent source clumping
      for (let i = globalEnrichedPool.length - 1; i > 0; i--) {
         const j = Math.floor(Math.random() * (i + 1));
         [globalEnrichedPool[i], globalEnrichedPool[j]] = [globalEnrichedPool[j], globalEnrichedPool[i]];
      }

      const finalInsert = [];
      const bucketsByPri = { high: [], medium: [], low: [] };

      const getPoints = p => ({ high: 5, medium: 2, low: 1 }[p] || 1);
      
      globalEnrichedPool.forEach(v => {
         const p = v.sourcePriority || 'low';
         bucketsByPri[p].push(v);
      });

      while (bucketsByPri.high.length > 0 || bucketsByPri.medium.length > 0 || bucketsByPri.low.length > 0) {
         let totalPoints = 0;
         if (bucketsByPri.high.length > 0) totalPoints += getPoints('high');
         if (bucketsByPri.medium.length > 0) totalPoints += getPoints('medium');
         if (bucketsByPri.low.length > 0) totalPoints += getPoints('low');

         let r = Math.random() * totalPoints;
         let selectedPri;

         if (bucketsByPri.high.length > 0) {
             r -= getPoints('high');
             if (r <= 0) selectedPri = 'high';
         }
         if (!selectedPri && bucketsByPri.medium.length > 0) {
             r -= getPoints('medium');
             if (r <= 0) selectedPri = 'medium';
         }
         if (!selectedPri && bucketsByPri.low.length > 0) selectedPri = 'low';

         finalInsert.push(bucketsByPri[selectedPri].pop());
      }
      
      // Remove used IDs from local pools
      const usedIdsBySource = {};
      finalInsert.forEach(v => {
          if (v.sourceId) {
              if (!usedIdsBySource[v.sourceId]) usedIdsBySource[v.sourceId] = [];
              usedIdsBySource[v.sourceId].push(v.id);
          }
      });
      
      for (const sourceId in usedIdsBySource) {
          const pool = await HistoryStore.getPool(sourceId);
          pool.ids = pool.ids.filter(id => !usedIdsBySource[sourceId].includes(id));
          await HistoryStore.savePool(sourceId, pool);
      }
      
      QueueEngine.smartInsert(finalInsert, toTop, activeBucket.shortsConstraint);

      this.render();

      if (QueueEngine.getQueue().length > 0 && document.getElementById('youtube-player').innerHTML === '') {
         this.playVideoCallback(QueueEngine.getQueue()[0], SettingsStore.getAutoplay());
      }
      
    } catch (e) {
      console.error(e);
      alert('Error fetching videos: ' + (e.message || e));
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }

  },

  async generateTimedStream(targetMinutes) {
     const activeId = SettingsStore.getActiveBucketId();
     const buckets = SettingsStore.getBuckets();
     const activeBucket = buckets.find(b => b.id === activeId);
     
     if (!activeBucket || !activeBucket.sources || activeBucket.sources.length === 0) {
       alert("Please configure sources for your active bucket in Settings first.");
       return;
     }

     const currentQueueSec = QueueEngine.getQueue().reduce((acc, v) => acc + (v.durationSec || 0), 0);
     const targetSec = targetMinutes * 60;
     
     if (currentQueueSec < targetSec - (2.5 * 60)) {
         console.log(`[Diagnostic] Local queue has ${Math.floor(currentQueueSec/60)}m. Fetching more to hit ${targetMinutes}m target...`);
         await this.fetchVideos(false); 
     }

     const success = QueueEngine.buildTimedQueue(targetMinutes, activeBucket);
     if (!success) {
         alert(`Not enough unplayed videos fetched to reach exactly ${targetMinutes} minutes. The queue has been built as close as possible!`);
     }
     
     this.render();
     if (QueueEngine.getQueue().length > 0 && document.getElementById('youtube-player').innerHTML === '') {
         this.playVideoCallback(QueueEngine.getQueue()[0], SettingsStore.getAutoplay());
     }
  },

  formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const num = parseInt(sec, 10);
    const m = Math.floor(num / 60);
    const s = num % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
};
