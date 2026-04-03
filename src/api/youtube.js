import { SettingsStore } from '../db/storage.js';

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export function parseDuration(duration) {
  if (!duration) return 0;
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0;
  
  const hours = (parseInt(match[1]) || 0);
  const minutes = (parseInt(match[2]) || 0);
  const seconds = (parseInt(match[3]) || 0);
  
  return hours * 3600 + minutes * 60 + seconds;
}

async function fetchAPI(endpoint, params) {
  const apiKey = SettingsStore.getYoutubeApiKey();
  if (!apiKey) throw new Error('No API Key configured. Please add it in Settings.');

  const searchParams = new URLSearchParams();
  for (const key in params) {
    if (params[key] !== undefined) {
      searchParams.append(key, params[key]);
    }
  }
  searchParams.append('key', apiKey);

  const response = await fetch(`${BASE_URL}/${endpoint}?${searchParams.toString()}`);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`YouTube API Error: ${response.status} - ${err.error?.message || response.statusText}`);
  }
  return response.json();
}

export const YouTubeApi = {
  async fetchSearchByChannelId(channelId, query, maxResults = 50) {
    const data = await fetchAPI('search', {
      part: 'snippet',
      channelId: channelId,
      q: query,
      type: 'video',
      maxResults: maxResults,
      order: 'date'
    });

    return data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url
    }));
  },

  async fetchUploadsByChannelId(channelId, maxResults = 50) {
    const playlistId = 'UU' + channelId.substring(2);
    return this.fetchPlaylistItems(playlistId, maxResults);
  },
  
  async fetchPlaylistItems(playlistId, maxResults = 50) {
    const data = await fetchAPI('playlistItems', {
      part: 'snippet',
      playlistId: playlistId,
      maxResults: maxResults
    });
    
    return data.items.map(item => ({
      id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      channelId: item.snippet.videoOwnerChannelId || '',
      channelTitle: item.snippet.videoOwnerChannelTitle || '',
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url
    }));
  },

  async fetchSourceMetadata(sourceId) {
    if (!sourceId) return null;
    try {
      if (sourceId.startsWith('UC')) {
        const data = await fetchAPI('channels', { part: 'snippet', id: sourceId });
        if (!data.items || data.items.length === 0) return null;
        return {
          title: data.items[0].snippet.title,
          thumbnail: data.items[0].snippet.thumbnails?.default?.url
        };
      } else if (sourceId.startsWith('PL')) {
        const data = await fetchAPI('playlists', { part: 'snippet', id: sourceId });
        if (!data.items || data.items.length === 0) return null;
        return {
          title: data.items[0].snippet.title,
          thumbnail: data.items[0].snippet.thumbnails?.default?.url
        };
      }
    } catch (e) {
      console.warn("Failed to fetch source metadata", e);
    }
    return null;
  },

  async fetchVideoDetails(videoIds) {
    if (!videoIds || videoIds.length === 0) return [];
    
    const chunks = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      chunks.push(videoIds.slice(i, i + 50).join(','));
    }
    
    const allVideos = [];
    for (const chunk of chunks) {
      const data = await fetchAPI('videos', {
        part: 'contentDetails,snippet',
        id: chunk
      });
      allVideos.push(...data.items);
    }
    
    return allVideos.map(v => ({
      id: v.id,
      title: v.snippet.title,
      channelId: v.snippet.channelId,
      channelTitle: v.snippet.channelTitle,
      durationSec: parseDuration(v.contentDetails.duration)
    }));
  }
};
