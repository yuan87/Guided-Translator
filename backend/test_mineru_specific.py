import requests
import json
import time
import os

token = "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJqdGkiOiIzNTQwMDM1NSIsInJvbCI6IlJPTEVfUkVHSVNURVIiLCJpc3MiOiJPcGVuWExhYiIsImlhdCI6MTc2ODY3NTkyMCwiY2xpZW50SWQiOiJsa3pkeDU3bnZ5MjJqa3BxOXgydyIsInBob25lIjoiIiwib3BlbklkIjpudWxsLCJ1dWlkIjoiZGJiNzkzYjktMmEwMy00NDBkLThmNDMtMmFkN2RmZGMyNDIxIiwiZW1haWwiOiIiLCJleHAiOjE3Njk4ODU1MjB9.vAETM8RutHWfk2B8wqZ-SJ8am9HzNRZU3BACsXBYSyrSi54s8MkhCZEG93Aq6EKKqm8t_rLLMwQUlc_BlzJOtg"

# Config
FILE_PATH = r"d:\myproject\Guided-Translator\fixtures\EN 12077-2 2024 - foxit.pdf"
API_BASE = "https://mineru.net/api/v4"
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}"
}

def test_mineru_flow():
    if not os.path.exists(FILE_PATH):
        print(f"Error: File not found: {FILE_PATH}")
        return

    print(f"=== Testing MinerU with file: {os.path.basename(FILE_PATH)} ===")
    
    # Step 1: Get Upload URL
    print("\n1. Requesting upload URL...")
    res = requests.post(
        f"{API_BASE}/file-urls/batch",
        headers=HEADERS,
        json={
            "files": [{"name": os.path.basename(FILE_PATH), "data_id": "test_debug_001"}],
            "model_version": "vlm"
        }
    )
    
    if res.status_code != 200:
        print(f"Failed to get URL: {res.text}")
        return
        
    data = res.json()["data"]
    batch_id = data["batch_id"]
    upload_url = data["file_urls"][0]
    print(f"   Batch ID: {batch_id}")
    print(f"   Upload URL obtained")
    
    # Step 2: Upload File
    print("\n2. Uploading file...")
    with open(FILE_PATH, "rb") as f:
        upload_res = requests.put(upload_url, data=f)
    
    if upload_res.status_code != 200:
        print(f"Upload failed: {upload_res.status_code} - {upload_res.text}")
        return
    print("   Upload successful")
    
    # Step 3: Poll Status
    print("\n3. Polling for results...")
    start_time = time.time()
    while time.time() - start_time < 300: # 5 min timeout
        res = requests.get(
            f"{API_BASE}/extract-results/batch/{batch_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if res.status_code != 200:
            print(f"   Poll status: {res.status_code}")
            time.sleep(5)
            continue
            
        result = res.json()
        status_data = result.get("data", {})
        state = status_data.get("state") or status_data.get("extract_status")
        progress = status_data.get("progress", 0)
        
        print(f"   State: {state}, Progress: {progress}%")
        
        extract_result = status_data.get("extract_result", [])
        
        if len(extract_result) > 0:
            print("\n4. Result received!")
            item = extract_result[0]
            print("   Result keys:", list(item.keys()))
            
            # Check for markdown content
            md_url = item.get("full_md_url") or item.get("markdown_url")
            md_content = item.get("md_content") or item.get("markdown_content")
            
            if md_url:
                print(f"   Markdown URL found: {md_url}")
                # Try downloading it
                md_res = requests.get(md_url)
                if md_res.status_code == 200:
                    print(f"   Downloaded MD length: {len(md_res.text)}")
                    print("   First 100 chars:", md_res.text[:100])
                else:
                    print("   Failed to download MD content")
            elif md_content:
                print(f"   Direct MD content length: {len(md_content)}")
            else:
                print("   NO MARKDOWN FOUND in result item!")
                print("   Full item dump:", json.dumps(item, indent=2))
                
            return
            
        if state in ["failed", "error"]:
            print(f"   Task failed: {status_data.get('err_msg')}")
            return
            
        time.sleep(5)

test_mineru_flow()
