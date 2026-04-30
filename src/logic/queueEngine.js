import { YouTubeApi } from '../api/youtube.js';
import { HistoryStore } from '../db/storage.js';

export const QueueEngine = {
  queue: [],
  activeIndex: 0,
  lastRejectionStats: { recency: 0, keywords: 0, shorts: 0, tooShort: 0, noDetails: 0, history: 0 },
  
  getActiveIndex() { return this.activeIndex; },


  setActiveIndex(idx) { this.activeIndex = idx; },
  
  isShort(durationSec) {
    return durationSec > 30 && durationSec <= 180;
  },

  isTooShort(durationSec) {
    return durationSec <= 30;
  },

  async filterAndEnrichVideos(rawVideos, bucketConfig, sourceConfig) {
    const videoIds = rawVideos.map(v => v.id);
    const details = await YouTubeApi.fetchVideoDetails(videoIds);
    
    let validVideos = [];
    
    // Reset stats
    this.lastRejectionStats = { recency: 0, keywords: 0, shorts: 0, tooShort: 0, noDetails: 0 };
    
    console.log(`[Diagnostic] Filtering ${rawVideos.length} raw videos...`);

    for (const raw of rawVideos) {
        const detail = details.find(d => d.id === raw.id);
        if (!detail) { 
            console.log(`[Diagnostic] Skipped ID "${raw.id}": API returned no details (Region locked or deleted)`); 
            this.lastRejectionStats.noDetails++;
            continue; 
        }

        if (!sourceConfig?.isRepeatable) {
            const watched = await HistoryStore.isWatched(raw.id);
            if (watched) { 
                console.log(`[Diagnostic] Skipped "${detail.title}": Already Watched in Local History`); 
                this.lastRejectionStats.history++;
                continue; 
            }

            const dismissed = await HistoryStore.isDismissed(raw.id);
            if (dismissed) { 
                console.log(`[Diagnostic] Skipped "${detail.title}": Already Dismissed in Local History`); 
                this.lastRejectionStats.history++;
                continue; 
            }
        } else {

            console.log(`[Diagnostic] History Bypass Active for "${detail.title}" (Repeatable Source)`);
        }

        if (this.isTooShort(detail.durationSec)) { 
            console.log(`[Diagnostic] Skipped "${detail.title}": Duration too short (${detail.durationSec}s)`); 
            this.lastRejectionStats.tooShort++;
            continue; 
        }

        const isSht = this.isShort(detail.durationSec);
        
        // 2. Cascade Shorts Logic
        const sourceShortsRule = sourceConfig?.shortsConstraint || 'mix';
        if (sourceShortsRule === 'no_shorts' && isSht) { 
            console.log(`[Diagnostic] Skipped "${detail.title}": Blocked by SOURCE No-Shorts rule RegExp`); 
            this.lastRejectionStats.shorts++;
            continue; 
        }
        if (sourceShortsRule === 'only_shorts' && !isSht) { 
            console.log(`[Diagnostic] Skipped "${detail.title}": Blocked by SOURCE Only-Shorts rule (Is standard video)`); 
            this.lastRejectionStats.shorts++;
            continue; 
        }

        const bucketShortsRule = bucketConfig.shortsConstraint || 'max_3';
        if (bucketShortsRule === 'no_shorts' && isSht) { 
            console.log(`[Diagnostic] Skipped "${detail.title}": Blocked by GLOBAL No-Shorts rule`); 
            this.lastRejectionStats.shorts++;
            continue; 
        }
        if (bucketShortsRule === 'only_shorts' && !isSht) { 
            console.log(`[Diagnostic] Skipped "${detail.title}": Blocked by GLOBAL Only-Shorts rule (Is standard video)`); 
            this.lastRejectionStats.shorts++;
            continue; 
        }

        validVideos.push({
            ...detail,
            isShort: isSht
        });
    }



    
    console.log(`[Diagnostic] Surviving videos: ${validVideos.length}`);
    return validVideos;
  },

  smartInsert(newVideos, toTop = false, shortsConstraint = 'max_3') {
    const itemsToAdd = [];
    
    // Check if there are ANY non-shorts in the candidate pool that aren't duplicates
    const candidates = newVideos.filter(video => !this.queue.some(v => v.id === video.id));
    const hasNonShorts = candidates.some(v => !v.isShort);
    
    for (const video of newVideos) {
      if (this.queue.some(v => v.id === video.id)) continue;
      
      if (video.isShort && shortsConstraint === 'max_3') {
        const recentContext = [...this.queue, ...itemsToAdd].slice(-3);
        const recentShortsCount = recentContext.filter(v => v.isShort).length;
        
        // Only skip the short if it breaks the streak AND we actually have non-shorts available to interleave!
        if (recentShortsCount >= 3 && hasNonShorts) {
          console.log(`[Diagnostic] Skipped short "${video.title}" to break 3-short streak (Non-shorts available to fill).`);
          continue; 
        }
      }
      itemsToAdd.push(video);
    }

    
    if (toTop) {
      this.queue.splice(1, 0, ...itemsToAdd);
    } else {
      this.queue.push(...itemsToAdd);
    }
  },

  getQueue() { return this.queue; },
  setQueue(newQueue) { this.queue = newQueue; },
  popNext() {
      const current = this.queue.shift();
      return this.queue[0]; 
  },
  buildTimedQueue(targetMinutes, activeBucket) {
     const TOLERANCE_SEC = 2.5 * 60; // 150s
     const TARGET_SEC = targetMinutes * 60;
     
     let pool = [...this.queue];
     let forcePools = {}; // sourceId -> { type, interval, nextTrigger, videos: [] }
     
     if (activeBucket.sources) {
         activeBucket.sources.forEach(s => {
             if (s.forcePlayType && s.forcePlayType !== 'none' && s.forcePlayInterval > 0) {
                 forcePools[s.id] = {
                     type: s.forcePlayType,
                     interval: s.forcePlayType === 'minutes' ? s.forcePlayInterval * 60 : s.forcePlayInterval,
                     nextTrigger: s.forcePlayType === 'minutes' ? s.forcePlayInterval * 60 : s.forcePlayInterval,
                     videos: pool.filter(v => v.sourceId === s.id)
                 };
             }
         });
     }

     let stdPool = pool.filter(v => !forcePools[v.sourceId]);
     let newQueue = [];
     let totalSec = 0;
     let totalVids = 0;
     
     while (totalSec < TARGET_SEC - TOLERANCE_SEC) {
         let forcedVideo = null;
         for (const sId in forcePools) {
             const fp = forcePools[sId];
             if (fp.videos.length === 0) continue;
             
             let triggered = false;
             if (fp.type === 'minutes' && totalSec >= fp.nextTrigger) {
                 triggered = true;
                 fp.nextTrigger += fp.interval;
             } else if (fp.type === 'videos' && totalVids === fp.nextTrigger - 1) { // 0-based insertion
                 triggered = true;
                 fp.nextTrigger += fp.interval;
             }
             
             if (triggered) {
                 forcedVideo = fp.videos.shift();
                 break; // Only pull one forced video per loop to avoid cascading conflicts
             }
         }
         
         let nextVid = forcedVideo;
         if (!nextVid) {
             if (stdPool.length === 0) break;
             nextVid = stdPool.shift();
         }
         
         if (totalSec + nextVid.durationSec > TARGET_SEC + TOLERANCE_SEC) {
             let minError = Math.abs(TARGET_SEC - totalSec);
             let bestSwapIdx = -1;
             let bestPoolIdx = -1;

             for (let i = 0; i < newQueue.length; i++) {
                 if (newQueue[i].isForced) continue; 
                 let err = Math.abs(TARGET_SEC - (totalSec + nextVid.durationSec - newQueue[i].durationSec));
                 if (err < minError) {
                     minError = err;
                     bestSwapIdx = i;
                 }
             }

             for (let i = 0; i < stdPool.length; i++) {
                 let err = Math.abs(TARGET_SEC - (totalSec + stdPool[i].durationSec));
                 if (err < minError) {
                     minError = err;
                     bestPoolIdx = i;
                     bestSwapIdx = -1;
                 }
             }

             let nextErr = Math.abs(TARGET_SEC - (totalSec + nextVid.durationSec));
             if (nextErr < minError) {
                 // Push nextVid natively
             } else if (bestSwapIdx !== -1) {
                 let removed = newQueue.splice(bestSwapIdx, 1)[0];
                 totalSec -= removed.durationSec;
                 totalVids--;
                 stdPool.unshift(removed);
             } else if (bestPoolIdx !== -1) {
                 if (!forcedVideo) stdPool.unshift(nextVid);
                 nextVid = stdPool.splice(bestPoolIdx, 1)[0];
             } else {
                 if (!forcedVideo) stdPool.unshift(nextVid);
                 break; 
             }
         }
         
         if (nextVid) {
             nextVid.isForced = !!forcedVideo;
             nextVid.isTimedBlock = true;
             newQueue.push(nextVid);
             totalSec += nextVid.durationSec;
             totalVids++;
             
             const globalIdx = pool.findIndex(v => v.id === nextVid.id);
             if (globalIdx !== -1) pool.splice(globalIdx, 1);
         }
     }
     
     const success = totalSec >= TARGET_SEC - TOLERANCE_SEC;
     this.queue = [...newQueue, ...pool]; // Prepend the assembled timed stream
     return success;
  },

  clearQueue() { this.queue = []; }
};
