from pytubefix import YouTube

def generate_tokens():
    # Use a safe video for auth
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    import os
    token_file = os.path.abspath("tokens.json")
    
    print(f"Initializing YouTube object to generate {token_file}...")
    print("Please follow the instructions to authenticate in your browser.")
    
    yt = YouTube(
        url, 
        use_oauth=True, 
        allow_oauth_cache=True,
        token_file=token_file
    )
    
    # Trigger auth flow
    print(f"Video Title: {yt.title}")
    print(f"\nSUCCESS! '{token_file}' has been created.")
    print("You can now deploy to Cloud Run.")

if __name__ == "__main__":
    generate_tokens()
