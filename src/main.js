import { SettingsStore, HistoryStore } from './db/storage.js';
import { QueueDrawer } from './ui/queueDrawer.js';
import { QueueEngine } from './logic/queueEngine.js';
import { YouTubeApi } from './api/youtube.js';

let player;
let isYoutubeApiReady = false;

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('Service Worker Registered'))
      .catch(err => console.error('Service Worker Error', err));
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
        if (player && typeof player.playVideo === 'function') player.playVideo();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        document.getElementById('btn-skip-next').click();
    });
  }

  document.addEventListener('visibilitychange', () => {
     if (document.hidden) {
        console.log(`[Diagnostic Trace] App shifted to background. Trial forced resume hack.`);
        if (player && typeof player.playVideo === 'function') player.playVideo();
     }
  });

  const debugEl = document.getElementById('orientation-debug');
  const handleOrientationUpdate = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isLandscape = w > h;
      
      if (debugEl) {
          debugEl.innerHTML = `Dim: ${w}x${h} | Mode: ${isLandscape ? 'Land' : 'Port'}`;
      }
      
      if (isLandscape) {
          document.body.classList.add('app-fullscreen');
          console.log('[Diagnostic Trace] Entering Root Landscape Maximization (Multi)');
      } else {
          document.body.classList.remove('app-fullscreen');
          console.log('[Diagnostic Trace] Exiting Root Landscape Maximization (Multi)');
      }
  };
  
  window.addEventListener('resize', handleOrientationUpdate);
  window.addEventListener('orientationchange', handleOrientationUpdate);
  if (screen.orientation) {
      screen.orientation.addEventListener('change', handleOrientationUpdate);
  }
  // Run once on load
  handleOrientationUpdate();



  const views = {



    player: document.getElementById('player-view'),
    settings: document.getElementById('settings-view'),
    history: document.getElementById('history-view')
  };

  const btnAutoplay = document.getElementById('btn-toggle-autoplay');
  const updateAutoplayUI = () => {
     btnAutoplay.style.opacity = SettingsStore.getAutoplay() ? '1' : '0.4';
  };
  updateAutoplayUI();

  btnAutoplay.addEventListener('click', (e) => {
     e.stopPropagation();
     SettingsStore.setAutoplay(!SettingsStore.getAutoplay());
     updateAutoplayUI();
  });

  document.getElementById('btn-open-history').addEventListener('click', () => {
    views.player.classList.remove('active');
    views.player.classList.add('hidden');
    views.history.classList.remove('hidden');
    views.history.classList.add('active');
    renderHistoryTab('saved'); // default tab
  });

  document.getElementById('btn-close-history').addEventListener('click', () => {
    views.history.classList.remove('active');
    views.history.classList.add('hidden');
    views.player.classList.remove('hidden');
    views.player.classList.add('active');
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    views.player.classList.remove('active');
    views.player.classList.add('hidden');
    views.settings.classList.remove('hidden');
    views.settings.classList.add('active');
    
    // Populate API Key from storage
    document.getElementById('input-youtube-api-key').value = SettingsStore.getYoutubeApiKey();
    
    renderSettingsBuckets(); // Re-render in case of changes
  });


  document.getElementById('btn-close-settings').addEventListener('click', () => {
    views.settings.classList.remove('active');
    views.settings.classList.add('hidden');
    views.player.classList.remove('hidden');
    views.player.classList.add('active');
  });

  const historyTabs = ['saved', 'watched', 'dismissed'];
  historyTabs.forEach(tab => {
     document.getElementById('tab-' + tab).addEventListener('click', (e) => {
        historyTabs.forEach(t => document.getElementById('tab-' + t).classList.remove('active'));
        e.target.classList.add('active');
        renderHistoryTab(tab);
     });
  });

  document.getElementById('btn-add-bucket').addEventListener('click', () => {
    saveBucketsFromDOM();
    const buckets = SettingsStore.getBuckets();
    buckets.push({
      id: `bucket_${Date.now()}`,
      name: `New Bucket ${buckets.length + 1}`,
      sources: [],
      keywords: '',
      shortsConstraint: 'max_3'
    });
    SettingsStore.setBuckets(buckets);
    renderSettingsBuckets();
  });

  document.getElementById('btn-save-buckets').addEventListener('click', () => {
    saveBucketsFromDOM();
    populateBucketSelector();
    alert('Buckets configuration saved successfully.');
  });

  document.getElementById('btn-save-api-key').addEventListener('click', () => {
      const key = document.getElementById('input-youtube-api-key').value.trim();
      SettingsStore.setYoutubeApiKey(key);
      alert('API Key saved successfully to your device!');
  });



  document.getElementById('btn-export-text').addEventListener('click', async () => {
      try {
          const data = {
              buckets: SettingsStore.getBuckets(),
              activeBucket: SettingsStore.getActiveBucketId(),
              autoplay: SettingsStore.getAutoplay(),
              history: {
                  saved: await HistoryStore.getAllStore('saved'),
                  watched: await HistoryStore.getAllStore('watched'),
                  dismissed: await HistoryStore.getAllStore('dismissed')
              }
          };
          const text = JSON.stringify(data, null, 2);
          const area = document.getElementById('textarea-backup-io');
          area.value = text;
          area.select();
          
          if (navigator.clipboard) {
              await navigator.clipboard.writeText(text);
              alert('Backup text generated and COPIED to clipboard!');
          } else {
              alert('Backup text generated! Highlight the text inside the box and copy it manually.');
          }
      } catch (e) {
          console.error('Export Text Error:', e);
          alert('Failed to generate backup text.');
      }
  });

  document.getElementById('btn-import-text').addEventListener('click', async () => {
      const area = document.getElementById('textarea-backup-io');
      const text = area.value.trim();
      if (!text) {
          alert('Please paste some backup text into the box first!');
          return;
      }
      
      try {
          const data = JSON.parse(text);
          if (data.buckets) SettingsStore.setBuckets(data.buckets);
          if (data.activeBucket) SettingsStore.setActiveBucketId(data.activeBucket);
          if (typeof data.autoplay !== 'undefined') SettingsStore.setAutoplay(data.autoplay);
          
          if (data.history) {
              if (data.history.watched) {
                 for (const v of data.history.watched) await HistoryStore.markWatched(v);
              }
              if (data.history.dismissed) {
                 for (const v of data.history.dismissed) await HistoryStore.markDismissed(v);
              }
              if (data.history.saved) {
                 for (const v of data.history.saved) await HistoryStore.markSaved(v);
              }
          }
          alert('Import Successful! Application will now reload.');
          location.reload();
      } catch (err) {
          console.error('Import Text Error:', err);
          alert('Failed to import text. Ensure the text is a valid LemurTube backup block.');
      }
  });


  renderSettingsBuckets();
  populateBucketSelector();

  QueueDrawer.init(playVideo);
});

async function renderHistoryTab(storeName) {
   const container = document.getElementById('history-list-container');
   container.innerHTML = '<div style="color:var(--text-secondary); text-align:center;">Loading...</div>';
   
   const records = await HistoryStore.getAllStore(storeName);
   // Sort newest first
   records.sort((a, b) => b.timestamp - a.timestamp);
   
   if (records.length === 0) {
      container.innerHTML = `<div style="color:var(--text-secondary); text-align:center; padding: 20px;">No ${storeName} videos found.</div>`;
      return;
   }
   
   container.innerHTML = '';
   records.forEach(v => {
      const el = document.createElement('div');
      el.className = 'queue-item';
      
      const dateStr = new Date(v.timestamp).toLocaleDateString();
      const thumb = v.thumbnail || '';
      const cTitle = v.channelTitle || 'Unknown Creator';
      const vTitle = v.title || v.id;
      
      el.innerHTML = `
        <img src="${thumb}" alt="thumb" class="video-thumb">
        <div class="video-info">
          <div class="video-title">${vTitle}</div>
          <div class="video-meta">${cTitle} • ${dateStr}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
           ${storeName === 'saved' ? `<button class="primary-btn play-btn" data-id="${v.id}" style="padding:4px 8px; font-size:0.8rem;">▶ Play</button>` : ''}
           <button class="secondary-btn del-btn" data-id="${v.id}" style="padding:4px 8px; font-size:0.8rem;">❌ ${storeName === 'saved' ? 'Unsave' : 'Forget'}</button>
        </div>
      `;
      
      if (storeName === 'saved') {
         el.querySelector('.play-btn').addEventListener('click', () => {
             document.getElementById('btn-close-history').click();
             playVideo(v, true); // Play immediately
         });
      }
      
      el.querySelector('.del-btn').addEventListener('click', async () => {
         await HistoryStore.removeFromStore(storeName, v.id);
         renderHistoryTab(storeName); // refresh
      });
      
      container.appendChild(el);
   });
}

function renderSettingsBuckets() {
   const container = document.getElementById('buckets-accordion');
   container.innerHTML = '';
   const buckets = SettingsStore.getBuckets();
   
   buckets.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'bucket-editor';
      
      let sourcesHtml = '';
      if (b.sources) {
          b.sources.forEach((src, srcIndex) => {
              sourcesHtml += `
                <div class="source-editor" data-index="${srcIndex}" data-meta-title="${src.metaTitle || ''}" data-meta-thumb="${src.metaThumb || ''}">
                   <div style="display:flex; justify-content:space-between; gap:8px;">
                      <input type="text" class="s-id" value="${src.id}" placeholder="UC... or PL..." style="flex-grow:1;">
                      <button class="icon-btn btn-delete-src" data-index="${srcIndex}" style="color:var(--danger-color); font-size:1rem;">X</button>
                   </div>
                   ${src.metaTitle ? `<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; margin-top:4px;"><img src="${src.metaThumb}" style="width:24px; height:24px; border-radius:50%;"><span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">${src.metaTitle}</span></div>` : ''}
                   <div class="source-config-row">
                      <input type="text" class="s-keywords" value="${src.keywords}" placeholder="Keywords (+ for AND)">
                      <select class="s-shorts">
                        <option value="mix" ${src.shortsConstraint === 'mix' ? 'selected' : ''}>Mix</option>
                        <option value="no_shorts" ${src.shortsConstraint === 'no_shorts' ? 'selected' : ''}>No Shorts</option>
                        <option value="only_shorts" ${src.shortsConstraint === 'only_shorts' ? 'selected' : ''}>Only Shorts</option>
                      </select>
                   </div>
                   <div class="source-config-row">
                      <select class="s-recency">
                        <option value="all" ${src.recency === 'all' ? 'selected' : ''}>All Time</option>
                        <option value="only_new" ${src.recency === 'only_new' ? 'selected' : ''}>Only New (<14 days)</option>
                      </select>
                      <select class="s-priority">
                        <option value="high" ${src.priority === 'high' ? 'selected' : ''}>High Pri</option>
                        <option value="medium" ${src.priority === 'medium' ? 'selected' : ''}>Med Pri</option>
                        <option value="low" ${src.priority === 'low' ? 'selected' : ''}>Fallback Pri</option>
                      </select>
                   </div>
                   <div style="margin-top:6px; font-size:0.85rem; color:var(--text-secondary); display:flex; flex-direction:column; gap:6px;">
                      <label><input type="checkbox" class="s-repeatable" ${src.isRepeatable ? 'checked' : ''}> Repeatable (Ignores Watch History)</label>
                      <div style="display:flex; align-items:center; gap:8px;">
                          <label>Force Play:</label>
                          <select class="s-force-type" style="padding:2px; font-size:0.8rem; background:var(--bg-color); color:var(--text-color); border:1px solid #333;">
                             <option value="none" ${src.forcePlayType === 'none' || !src.forcePlayType ? 'selected' : ''}>None</option>
                             <option value="videos" ${src.forcePlayType === 'videos' ? 'selected' : ''}>Every X Videos</option>
                             <option value="minutes" ${src.forcePlayType === 'minutes' ? 'selected' : ''}>Every X Minutes</option>
                          </select>
                          <input type="number" class="s-force-interval" value="${src.forcePlayInterval || ''}" placeholder="X" style="width:50px; padding:2px; font-size:0.8rem; background:var(--bg-color); color:var(--text-color); border:1px solid #333;" min="1" onchange="if(this.value<1) this.value=1;">
                      </div>
                   </div>
                </div>
              `;
          });
      }

      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <input type="text" class="b-name" data-id="${b.id}" value="${b.name}" style="flex-grow:1; margin-right:8px; font-weight:bold;">
          <button class="icon-btn btn-delete-bucket" style="font-size:0.9rem; color: var(--danger-color);" data-id="${b.id}">Trash Cache</button>
        </div>
        
        <label>Global Bucket Overrides:</label>
        <div class="source-config-row" style="margin-bottom: 20px;">
          <input type="text" class="b-keywords" value="${b.keywords || ''}" placeholder="Global Keywords">
          <select class="b-shorts">
            <option value="allow_all" ${b.shortsConstraint === 'allow_all' ? 'selected' : ''}>Allow All Shorts</option>
            <option value="max_3" ${b.shortsConstraint === 'max_3' ? 'selected' : ''}>Max 3 Shorts</option>
            <option value="no_shorts" ${b.shortsConstraint === 'no_shorts' ? 'selected' : ''}>No Shorts</option>
            <option value="only_shorts" ${b.shortsConstraint === 'only_shorts' ? 'selected' : ''}>Only Shorts</option>
          </select>
        </div>

        <label style="border-bottom:1px solid #333; padding-bottom:4px; display:block;">Sources (${b.sources ? b.sources.length : 0})</label>
        <div class="sources-container" style="margin-top:8px;">
          ${sourcesHtml}
        </div>
        <button class="secondary-btn btn-add-src" style="width:100%; margin-top:12px; padding:8px; font-size:0.9rem;">+ Add Specific Source</button>
      `;
      container.appendChild(el);
      
      const delBtn = el.querySelector('.btn-delete-bucket');
      delBtn.addEventListener('click', () => {
         if(confirm(`Delete ${b.name}?`)) {
            saveBucketsFromDOM();
            let current = SettingsStore.getBuckets();
            current = current.filter(cb => cb.id !== b.id);
            if (current.length === 0) {
               current.push({ id:'bucket_1', name:'Default Bucket', sources:[], keywords:'', shortsConstraint:'max_3' });
            }
            SettingsStore.setBuckets(current);
            renderSettingsBuckets();
            populateBucketSelector();
         }
      });

      const addSrcBtn = el.querySelector('.btn-add-src');
      addSrcBtn.addEventListener('click', () => {
          saveBucketsFromDOM(); 
          const current = SettingsStore.getBuckets();
          const target = current.find(cb => cb.id === b.id);
          target.sources.push({ id:'', keywords:'', shortsConstraint:'mix', recency:'all', priority:'medium' });
          SettingsStore.setBuckets(current);
          renderSettingsBuckets();
      });

      const delSrcBtns = el.querySelectorAll('.btn-delete-src');
      delSrcBtns.forEach(btn => {
         btn.addEventListener('click', (e) => {
             const idx = parseInt(e.target.getAttribute('data-index'), 10);
             if (confirm('Remove this source?')) {
                 saveBucketsFromDOM();
                 const current = SettingsStore.getBuckets();
                 const target = current.find(cb => cb.id === b.id);
                 target.sources.splice(idx, 1);
                 SettingsStore.setBuckets(current);
                 renderSettingsBuckets();
             }
         });
      });

      const sIdInputs = el.querySelectorAll('.s-id');
      sIdInputs.forEach((input, idx) => {
         input.addEventListener('change', async (e) => {
             const newId = e.target.value.trim();
             if (newId.length > 5) {
                 const meta = await YouTubeApi.fetchSourceMetadata(newId);
                 if (meta) {
                     saveBucketsFromDOM();
                     const current = SettingsStore.getBuckets();
                     const target = current.find(cb => cb.id === b.id);
                     if (target && target.sources[idx]) {
                         target.sources[idx].metaTitle = meta.title;
                         target.sources[idx].metaThumb = meta.thumbnail;
                         SettingsStore.setBuckets(current);
                         renderSettingsBuckets();
                     }
                 }
             }
         });
      });
   });
}

function saveBucketsFromDOM() {
   const container = document.getElementById('buckets-accordion');
   const editors = container.querySelectorAll('.bucket-editor');
   const newBuckets = [];
   
   editors.forEach(ed => {
      const srcNodes = ed.querySelectorAll('.source-editor');
      const sources = [];
      srcNodes.forEach(node => {
          sources.push({
             id: node.querySelector('.s-id').value,
             keywords: node.querySelector('.s-keywords').value,
             shortsConstraint: node.querySelector('.s-shorts').value,
             recency: node.querySelector('.s-recency').value,
             priority: node.querySelector('.s-priority').value,
             isRepeatable: node.querySelector('.s-repeatable').checked,
             forcePlayType: node.querySelector('.s-force-type').value,
             forcePlayInterval: parseInt(node.querySelector('.s-force-interval').value, 10) || null,
             metaTitle: node.getAttribute('data-meta-title'),
             metaThumb: node.getAttribute('data-meta-thumb')
          });
      });

      newBuckets.push({
         id: ed.querySelector('.b-name').getAttribute('data-id'),
         name: ed.querySelector('.b-name').value,
         sources: sources,
         keywords: ed.querySelector('.b-keywords').value,
         shortsConstraint: ed.querySelector('.b-shorts').value
      });
   });
   
   SettingsStore.setBuckets(newBuckets);
}

function populateBucketSelector() {
    const selector = document.getElementById('bucket-selector');
    selector.innerHTML = '';
    const buckets = SettingsStore.getBuckets();
    const activeId = SettingsStore.getActiveBucketId();
    
    buckets.forEach(b => {
       const opt = document.createElement('option');
       opt.value = b.id;
       opt.textContent = b.name;
       if (b.id === activeId) opt.selected = true;
       selector.appendChild(opt);
    });
}

window.onYouTubeIframeAPIReady = () => {
  isYoutubeApiReady = true;
};

function playVideo(videoObj, autoStart = true) {
  if ('mediaSession' in navigator && videoObj) {
      navigator.mediaSession.metadata = new MediaMetadata({
          title: videoObj.title || 'LemurTube Loop',
          artist: videoObj.channelTitle || 'YouTube',
          artwork: [
              { src: videoObj.thumbnail || './assets/icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
      });
  }

  const container = document.getElementById('youtube-player');
  container.innerHTML = '';

  
  if (player && typeof player.destroy === 'function') {
    player.destroy();
  }

  const escapeBtn = document.getElementById('btn-escape-hatch');
  if (escapeBtn && videoObj && videoObj.id) {
     escapeBtn.href = `https://www.youtube.com/watch?v=${videoObj.id}`;
     escapeBtn.style.display = 'flex';
  } else if (escapeBtn) {
     escapeBtn.style.display = 'none';
  }

  let startSeconds = 0;
  const savedState = SettingsStore.getPlaybackState();
  if (savedState && savedState.videoId === videoObj.id && savedState.timeSec > 0) {
     startSeconds = Math.floor(savedState.timeSec);
     console.log(`[Playback Memory] Resuming ${videoObj.id} from ${startSeconds}s`);
  }

  const commonVars = {
    'playsinline': 1,
    'modestbranding': 1,
    'rel': 0,
    'start': startSeconds
  };

  if (isYoutubeApiReady && window.YT && window.YT.Player) {
     player = new YT.Player('youtube-player', {
       height: '100%',
       width: '100%',
       videoId: videoObj.id,
       playerVars: { ...commonVars, 'autoplay': autoStart ? 1 : 0 },
       events: { 'onStateChange': onPlayerStateChange }
     });
  } else if (typeof YT !== 'undefined' && YT.Player) {
     player = new YT.Player('youtube-player', {
       height: '100%',
       width: '100%',
       videoId: videoObj.id, 
       playerVars: { ...commonVars, 'autoplay': autoStart ? 1 : 0 },
       events: { 'onStateChange': onPlayerStateChange }
     });
  } else {
    setTimeout(() => playVideo(videoObj, autoStart), 1000);
  }
}

// Global hook to memory-sync the playback timestamp every 15 seconds
setInterval(() => {
   if (player && typeof player.getCurrentTime === 'function' && typeof player.getVideoData === 'function') {
      const state = player.getPlayerState();
      // 1 is Playing, 2 is Paused. Save state if we are active.
      if (state === 1 || state === 2) {
         try {
           const id = player.getVideoData().video_id;
           const time = player.getCurrentTime();
           if (id && time > 0) {
              SettingsStore.savePlaybackState(id, time);
           }
         } catch (e) {}
      }
   }
}, 15000);

async function onPlayerStateChange(event) {
  if (event.data === 0) {
    const queue = QueueEngine.getQueue();
    const activeIdx = QueueEngine.getActiveIndex();
    
    if (activeIdx < queue.length) {
       const finishedVideo = queue[activeIdx];
       await HistoryStore.markWatched(finishedVideo);
       
       queue.splice(activeIdx, 1); // remove the video so it disappears from the list
       QueueEngine.setQueue(queue);
       QueueDrawer.render();
       
       // Play the video that shifted up into the activeIdx slot
       if (SettingsStore.getAutoplay() && activeIdx < queue.length) {
           playVideo(queue[activeIdx], true);
       } else if (queue.length === 0) {
           document.getElementById('youtube-player').innerHTML = ''; // Clear video
       }
    }
  }
}
