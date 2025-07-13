import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})

export class VideoService {
  private videoCache: Map<string, string> = new Map(); // originalPath -> blobURL

  async preloadVideos(basePath: string, count: number): Promise<void> {
    const alpha = 'ABCDEFGHIJKLMNOPQRST';

    for (let i = 0; i < count; i++) {
      const letter = alpha[i];
      const originalPath = `${basePath}${letter}.mp4`;

      // Skip if already cached
      if (this.videoCache.has(originalPath)) continue;

      const response = await fetch(originalPath);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      this.videoCache.set(originalPath, blobUrl);
    }
  }

  getBlobUrl(originalPath: string): string | undefined {
    return this.videoCache.get(originalPath);
  }

  clearCache(): void {
    // Optional: revoke object URLs to free memory
    for (const blobUrl of this.videoCache.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.videoCache.clear();
  }
}