export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const objectKey = url.pathname.slice(1);

    const object = await env.VIDEO_BUCKET.get(objectKey, {
      cacheTtl: 31536000 // still tells Cloudflare it's okay to cache
    });

    if (!object || !object.body) {
      return new Response("Video not found", { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=31536000",
        "Access-Control-Allow-Origin": "*"
      },
    });
  }
}
