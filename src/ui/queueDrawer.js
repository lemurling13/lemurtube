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

    this.sortState = 'newest';

    document.getElementById('btn-find-new').addEventListener('click', async (e) => {


        const btn = e.target;
        const oldHtml = btn.innerHTML;
        btn.innerHTML = 'Finding...';
        btn.disabled = true;
        try {
            await this.findNewVideos();
        } catch (err) {
            console.error(err);
            alert('Find New failed.');
        } finally {
            btn.innerHTML = oldHtml;
            btn.disabled = false;
        }
    });

    const sortBtn = document.getElementById('btn-toggle-sort');
    sortBtn.addEventListener('click', () => {
        if (this.sortState === 'newest') {
            this.sortState = 'oldest';
            sortBtn.innerHTML = 'Oldest';
        } else if (this.sortState === 'oldest') {
            this.sortState = 'random';
            sortBtn.innerHTML = 'Random';
        } else {
            this.sortState = 'newest';
            sortBtn.innerHTML = 'Newest';
        }
        this.sortQueue();
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
          // Take top 50 candidates to give lottery pool rich variety
          const candidates = pool.ids.slice(0, 50).map(id => ({ id }));
          return { src, rawVideos: candidates };
      });




      const allFetchedData = await Promise.all(fetchPromises);
      let globalEnrichedPool = [];

      let rejectionStats = { recency: 0, keywords: 0, shorts: 0, tooShort: 0, noDetails: 0 };

      for (const data of allFetchedData) {
           if (data.rawVideos.length > 0) {
                const enrichedForSource = await QueueEngine.filterAndEnrichVideos(data.rawVideos, activeBucket, data.src);
                globalEnrichedPool = globalEnrichedPool.concat(enrichedForSource.map(v => ({...v, sourcePriority: data.src.priority, sourceId: data.src.id})));
           }
      }
      
      const rej = QueueEngine.lastRejectionStats;
      const stats = allFetchedData.map(d => `${d.src.id.substring(0,5)}..: ${d.rawVideos.length}`).join('<br>');
      
      if (globalEnrichedPool.length === 0) {
          this.listEl.innerHTML = `<div class="empty-state">
              Queue is empty.<br>
              Zero videos survived filters.<br><br>
              <b>Rejection Breakdown:</b><br>
              - In History: ${rej.history}<br>
              - Keywords: ${rej.keywords}<br>
              - Recency (<14d): ${rej.recency}<br>
              - Shorts Rule: ${rej.shorts}<br>
              - Too Short (<30s): ${rej.tooShort}<br>
              - No API Details: ${rej.noDetails}<br><br>

              <b>Pool Candidates:</b><br>${stats}
          </div>`;
          btn.innerHTML = oldHtml;
          btn.disabled = false;
          return;
      }


      for (let i = globalEnrichedPool.length - 1; i > 0; i--) {
         const j = Math.floor(Math.random() * (i + 1));
         [globalEnrichedPool[i], globalEnrichedPool[j]] = [globalEnrichedPool[j], globalEnrichedPool[i]];
      }

      const finalInsert = [];
      const sourcesPools = {};
      
      // Group by source
      globalEnrichedPool.forEach(v => {
          if (v.sourceId) {
              if (!sourcesPools[v.sourceId]) sourcesPools[v.sourceId] = [];
              sourcesPools[v.sourceId].push(v);
          }
      });

      const activeSourceIds = Object.keys(sourcesPools);
      const getPoints = p => ({ high: 5, medium: 2, low: 1 }[p] || 1);

      // Lottery loop: Pick a source, then pop a video!
      while (activeSourceIds.length > 0) {
          let totalPoints = 0;
          activeSourceIds.forEach(id => {
              const pool = sourcesPools[id];
              const priority = pool.length > 0 ? pool[0].sourcePriority : 'low';
              totalPoints += getPoints(priority);
          });

          let r = Math.random() * totalPoints;
          let selectedSourceId = null;

          for (const id of activeSourceIds) {
              const pool = sourcesPools[id];
              const priority = pool.length > 0 ? pool[0].sourcePriority : 'low';
              r -= getPoints(priority);
              if (r <= 0) {
                  selectedSourceId = id;
                  break;
              }
          }

          if (selectedSourceId) {
              const video = sourcesPools[selectedSourceId].pop();
              finalInsert.push(video);
              
              // Remove source if exhausted
              if (sourcesPools[selectedSourceId].length === 0) {
                  const idx = activeSourceIds.indexOf(selectedSourceId);
                  activeSourceIds.splice(idx, 1);
              }
          }
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

  async findNewVideos() {

    const activeId = SettingsStore.getActiveBucketId();
    const buckets = SettingsStore.getBuckets();
    const activeBucket = buckets.find(b => b.id === activeId);

    if (!activeBucket || !activeBucket.sources) return;

    let totalNewFound = 0;

    for (const src of activeBucket.sources) {
        if (!src.id || src.id.trim().length < 5) continue;

        try {
            let rawVideos = [];
            if (src.id.startsWith('UC') || src.id.startsWith('UCA')) {
                if (src.keywords && src.keywords.trim()) {
                    rawVideos = await YouTubeApi.fetchSearchByChannelId(src.id, src.keywords, 50);
                } else {
                    let mappedId = src.id;
                    if (src.id.startsWith('UC')) mappedId = 'UU' + src.id.slice(2);
                    rawVideos = await YouTubeApi.fetchPlaylistItems(mappedId, 50);
                }
            } else if (src.id.startsWith('PL')) {
                rawVideos = await YouTubeApi.fetchPlaylistItems(src.id, 50);
            }

            const pool = await HistoryStore.getPool(src.id);
            const videoIds = rawVideos.map(v => v.id);
            let details = [];
            if (videoIds.length > 0) details = await YouTubeApi.fetchVideoDetails(videoIds);

            const newIds = [];
            const newVideosForQueue = [];

            for (const raw of rawVideos) {
                if (pool.ids.includes(raw.id)) continue;
                const watched = await HistoryStore.isWatched(raw.id);
                if (watched) continue;
                const dismissed = await HistoryStore.isDismissed(raw.id);
                if (dismissed) continue;

                const detail = details.find(d => d.id === raw.id);
                if (!detail) continue;

                const dateToUse = detail.publishedAt || raw.publishedAt;
                if (src.recency === 'only_new' && dateToUse) {
                   const pubDate = new Date(dateToUse).getTime();
                   if (Date.now() - pubDate > 14 * 24 * 60 * 60 * 1000) continue;
                }

                const titleLower = (detail.title || '').toLowerCase();
                const runKeywordFilter = (kwString) => {
                    if (!kwString) return true;
                    return kwString.split(',').map(kw => kw.trim().toLowerCase()).filter(k=>k).some(kwGroup => {
                        return kwGroup.split('+').map(w => w.trim()).every(word => titleLower.includes(word));
                    });
                };

                if (!runKeywordFilter(src.keywords)) continue;
                if (!runKeywordFilter(activeBucket.keywords)) continue;

                newIds.push(raw.id);
                newVideosForQueue.push({ 
                    ...detail, 
                    isShort: (detail.durationSec > 30 && detail.durationSec <= 180), 
                    sourcePriority: src.priority, 
                    sourceId: src.id 
                });
            }

            if (newIds.length > 0) {
                pool.ids.push(...newIds);
                await HistoryStore.savePool(src.id, pool);
                totalNewFound += newIds.length;

                const labelEl = document.querySelector(`.pool-count-label[data-source-id="${src.id}"]`);
                if (labelEl) labelEl.innerHTML = `Pool: ${pool.ids.length}`;
                
                QueueEngine.smartInsert(newVideosForQueue, false, activeBucket.shortsConstraint);
            }
        } catch (e) {
            console.error(`Find New failed for source ${src.id}:`, e);
        }
    }

    if (totalNewFound > 0) {
        this.sortQueue();
        alert(`Added ${totalNewFound} new videos to the queue!`);
    } else {
        alert('No new uploads found.');
    }
  },

  sortQueue() {
      const queue = QueueEngine.getQueue();
      if (this.sortState === 'newest') {
          queue.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
      } else if (this.sortState === 'oldest') {
          queue.sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
      } else if (this.sortState === 'random') {
          for (let i = queue.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [queue[i], queue[j]] = [queue[j], queue[i]];
          }
      }
      QueueEngine.setQueue(queue);
      this.render();
  },

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
