"""
MinerU Cloud API Test Script
Based on official documentation example.
"""
import requests
import time

# Configuration
token = "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJqdGkiOiIzNTQwMDM1NSIsInJvbCI6IlJPTEVfUkVHSVNURVIiLCJpc3MiOiJPcGVuWExhYiIsImlhdCI6MTc2ODY3NTkyMCwiY2xpZW50SWQiOiJsa3pkeDU3bnZ5MjJqa3BxOXgydyIsInBob25lIjoiIiwib3BlbklkIjpudWxsLCJ1dWlkIjoiZGJiNzkzYjktMmEwMy00NDBkLThmNDMtMmFkN2RmZGMyNDIxIiwiZW1haWwiOiIiLCJleHAiOjE3Njk4ODU1MjB9.vAETM8RutHWfk2B8wqZ-SJ8am9HzNRZU3BACsXBYSyrSi54s8MkhCZEG93Aq6EKKqm8t_rLLMwQUlc_BlzJOtg"
url = "https://mineru.net/api/v4/file-urls/batch"
header = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}"
}

# Test file
file_path = [r"d:\myproject\Guided-Translator\fixtures\EN 12077-2 2024 - foxit.pdf"]

data = {
    "files": [
        {"name": "EN 12077-2 2024 - foxit.pdf", "data_id": "test001"}
    ],
    "model_version": "vlm"
}

print("=== MinerU Cloud API Test (Official Example) ===\n")

try:
    # Step 1: Request upload URLs
    print("Step 1: Requesting upload URL...")
    response = requests.post(url, headers=header, json=data)
    
    if response.status_code == 200:
        result = response.json()
        print(f'Response success. Result: {result}\n')
        
        if result["code"] == 0:
            batch_id = result["data"]["batch_id"]
            urls = result["data"]["file_urls"]
            print(f'batch_id: {batch_id}')
            print(f'upload_url: {urls[0][:80]}...\n')
            
            # Step 2: Upload files
            print("Step 2: Uploading file...")
            for i in range(0, len(urls)):
                with open(file_path[i], 'rb') as f:
                    print(f"  Uploading {file_path[i]}...")
                    start_time = time.time()
                    res_upload = requests.put(urls[i], data=f)
                    elapsed = time.time() - start_time
                    
                    if res_upload.status_code == 200:
                        print(f"  ✅ Upload success! Time: {elapsed:.1f}s")
                    else:
                        print(f"  ❌ Upload failed: Status {res_upload.status_code}")
                        print(f"  Response: {res_upload.text[:200]}")
            
            # Step 3: Poll for results
            print("\nStep 3: Polling for results...")
            result_url = f"https://mineru.net/api/v4/extract-results/batch/{batch_id}"
            
            for attempt in range(60):  # Max 5 minutes (60 * 5s)
                time.sleep(5)
                print(f"  Checking... (attempt {attempt + 1})")
                
                res_status = requests.get(
                    result_url,
                    headers={"Authorization": f"Bearer {token}"}
                )
                
                if res_status.status_code == 200:
                    status_result = res_status.json()
                    if status_result.get("code") == 0:
                        data = status_result.get("data", {})
                        extract_result = data.get("extract_result", [])
                        
                        if extract_result:
                            print(f"\n✅ Extraction complete!")
                            print(f"  Result keys: {list(extract_result[0].keys())}")
                            
                            # Try to get markdown
                            first = extract_result[0]
                            md_url = first.get("full_md_url") or first.get("markdown_url")
                            if md_url:
                                print(f"  Markdown URL: {md_url[:80]}...")
                                md_res = requests.get(md_url)
                                if md_res.status_code == 200:
                                    print(f"  Markdown content length: {len(md_res.text)}")
                                    print(f"\n  First 500 chars of markdown:")
                                    print(f"  {md_res.text[:500]}")
                            break
                    else:
                        print(f"  Status: {status_result.get('msg')}")
                else:
                    print(f"  Poll failed: {res_status.status_code}")
            else:
                print("  ❌ Timeout waiting for results")
                        
        else:
            print(f'Apply upload url failed, reason: {result.get("msg")}')
    else:
        print(f'Response not success. Status: {response.status_code}, Result: {response.text}')
        
except Exception as err:
    print(f"Error: {err}")

input("\nPress Enter to exit...")
