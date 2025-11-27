import os
import glob
import logging
import json
import typing_extensions as typing
import google.generativeai as genai
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks # Changed from BackgroundTasks to Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pytubefix import YouTube # Replaced yt_dlp with pytubefix
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") # Renamed GENAI_API_KEY to GOOGLE_API_KEY
if not GOOGLE_API_KEY:
    logger.warning("GOOGLE_API_KEY not found in environment variables")

genai.configure(api_key=GOOGLE_API_KEY)

class VideoRequest(BaseModel): # Renamed GenerateRequest to VideoRequest
    url: str

def cleanup_file(path: str):
    """Deletes the file at the given path."""
    try:
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"Deleted temp file: {path}")
    except Exception as e:
        logger.error(f"Error deleting file {path}: {e}")

def download_audio(youtube_url: str) -> str:
    """Downloads audio from YouTube using pytubefix."""
    logger.info(f"Attempting to download audio from: {youtube_url}")
    
    # Clean up any existing files for this ID
    try:
        # pytubefix doesn't directly give video_id before YouTube() call,
        # so we parse it from the URL for cleanup purposes.
        video_id = youtube_url.split('v=')[-1].split('&')[0]
        for f in glob.glob(f"/tmp/*{video_id}*"):
            try:
                os.remove(f)
            except Exception as e:
                logger.warning(f"Could not remove old file {f}: {e}")
    except Exception as e:
        logger.warning(f"Error during pre-download cleanup: {e}")

    try:
        # Anti-Bot: Use OAuth2 with cached tokens
        # We expect 'tokens.json' to be present in the working directory (uploaded via gcloud deploy)
        token_file = os.path.abspath("tokens.json")
        use_oauth = False
        
        if os.path.exists(token_file):
            logger.info(f"Found {token_file}, using OAuth2.")
            use_oauth = True
        else:
            logger.warning(f"{token_file} not found. Bot detection may occur.")

        yt = YouTube(
            youtube_url, 
            use_oauth=use_oauth, 
            allow_oauth_cache=True,
            token_file=token_file
        )
        
        # Get the best audio stream
        # pytubefix's get_audio_only() typically returns m4a
        ys = yt.streams.get_audio_only()
        if not ys:
            raise Exception("No audio stream found for the given URL.")
            
        logger.info(f"Found audio stream: {ys.mime_type}, resolution: {ys.abr}, filesize: {ys.filesize_mb:.2f} MB")
        
        # Check file size (approximate)
        # pytubefix gives filesize in bytes
        if ys.filesize > 150 * 1024 * 1024: # 150MB limit
             raise Exception(f"Audio file is too large ({ys.filesize / (1024*1024):.2f} MB). Limit is 150MB.")

        # Download
        output_path = "/tmp"
        # Force m4a extension for consistency, as get_audio_only() usually provides it
        filename = f"{yt.video_id}.m4a" 
        
        logger.info(f"Downloading to {output_path}/{filename}...")
        ys.download(output_path=output_path, filename=filename)
        
        file_path = os.path.join(output_path, filename)
        
        if not os.path.exists(file_path):
            raise Exception("Download finished but file not found.")
            
        file_size = os.path.getsize(file_path)
        logger.info(f"Download complete. File size: {file_size / (1024*1024):.2f} MB")
        
        # Double check size after download
        if file_size > 100 * 1024 * 1024: # 100MB limit for processing
            os.remove(file_path)
            raise Exception("Audio file too large (>100MB) after download.")

        return file_path

    except Exception as e:
        logger.error(f"Download failed: {str(e)}")
        # Re-raise as HTTPException for FastAPI to catch
        raise HTTPException(status_code=400, detail=f"Failed to download audio: {str(e)}")


class BlogPost(typing.TypedDict):
    title: str
    content_html: str
    summary_for_card: str

def generate_blog_content(audio_path: str) -> dict:
    """Uploads audio to Gemini and generates blog post as JSON."""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured")

    try:
        logger.info(f"Uploading file: {audio_path}")
        # Explicitly set mime_type to avoid detection errors
        audio_file = genai.upload_file(audio_path, mime_type="audio/mp3")
        
        # Use standard Flash model for better JSON adherence, with retries for 429s
        model = genai.GenerativeModel("gemini-2.0-flash")
        
        prompt = """
        You are a professional content writer. Listen to this audio and create a comprehensive, detailed blog post.
        
        STRICT OUTPUT RULES:
        1. Return ONLY a valid JSON string. No markdown formatting.
        2. NO emojis.
        3. NO repetition.
        4. NO hashtags.
        5. Content must be in English, detailed, and professional.
        
        CONTENT REQUIREMENTS:
        - Write a full-length article (approx 800-1000 words).
        - Include an Introduction, Detailed Breakdown of key topics, and a Conclusion.
        - Use <h2> for main sections and <h3> for subsections.
        - Use <ul>/<li> for lists where appropriate.
        - The tone should be engaging and educational.
        
        JSON STRUCTURE:
        {
          "title": "Clear, professional title",
          "content_html": "The full, detailed blog post in HTML. Use <h2>, <h3>, <p>, and <ul> tags. No <h1>.",
          "summary_for_card": "A 2-3 sentence summary for the preview card."
        }
        """
        
        logger.info("Generating content...")
        
        # Retry logic for 429 errors
        import time
        max_retries = 3
        base_delay = 2
        
        for attempt in range(max_retries):
            try:
                # Use standard text generation to avoid constrained decoding loops
                response = model.generate_content(
                    [prompt, audio_file],
                    generation_config=genai.GenerationConfig(
                        temperature=0.0,
                        response_mime_type="application/json"
                    )
                )
                
                # Clean up response text (remove markdown code blocks if present)
                text = response.text.strip()
                if text.startswith("```json"):
                    text = text[7:]
                if text.startswith("```"):
                    text = text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()
                
                logger.info(f"Raw Gemini Response: {text[:200]}...") # Log first 200 chars
                return json.loads(text)
            except Exception as e:
                logger.error(f"Attempt {attempt+1} failed: {e}")
                if "429" in str(e) and attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(f"Rate limit hit (429). Retrying in {delay}s...")
                    time.sleep(delay)
                else:
                    if attempt == max_retries - 1:
                         raise e
    except Exception as e:
        logger.error(f"Gemini generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.post("/generate")
async def generate_blog(request: VideoRequest, background_tasks: BackgroundTasks):
    audio_path = None
    try:
        # 1. Download Audio
        logger.info(f"Processing URL: {request.url}")
        audio_path = download_audio(request.url)
        
        # 2. Generate Content
        blog_data = generate_blog_content(audio_path)
        
        # 3. Cleanup (using background tasks to ensure it runs)
        background_tasks.add_task(cleanup_file, audio_path)
        
        return blog_data
        
    except HTTPException as e:
        if audio_path:
            cleanup_file(audio_path)
        raise e
    except Exception as e:
        if audio_path:
            cleanup_file(audio_path)
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
