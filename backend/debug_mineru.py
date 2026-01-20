"""
MinerU Connectivity Diagnostic Tool
Run this to identify why uploads are failing.
"""
import requests
import time
import os
import sys
import uuid

# Configuration
TOKEN = "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJqdGkiOiIzNTQwMDM1NSIsInJvbCI6IlJPTEVfUkVHSVNURVIiLCJpc3MiOiJPcGVuWExhYiIsImlhdCI6MTc2ODY3NTkyMCwiY2xpZW50SWQiOiJsa3pkeDU3bnZ5MjJqa3BxOXgydyIsInBob25lIjoiIiwib3BlbklkIjpudWxsLCJ1dWlkIjoiZGJiNzkzYjktMmEwMy00NDBkLThmNDMtMmFkN2RmZGMyNDIxIiwiZW1haWwiOiIiLCJleHAiOjE3Njk4ODU1MjB9.vAETM8RutHWfk2B8wqZ-SJ8am9HzNRZU3BACsXBYSyrSi54s8MkhCZEG93Aq6EKKqm8t_rLLMwQUlc_BlzJOtg"
PDF_FILE = r"d:\myproject\Guided-Translator\fixtures\EN 12077-2 2024 - foxit.pdf"

API_BASE = "https://mineru.net/api/v4"
OSS_HOST = "mineru.oss-cn-shanghai.aliyuncs.com"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def check_network():
    print("\n=== 1. Checking Connectivity ===")
    
    # Check 1: API
    try:
        t0 = time.time()
        requests.get(API_BASE, timeout=5)
        latency = (time.time() - t0) * 1000
        log(f"✅ MinerU API ({API_BASE}): Reachable ({latency:.0f}ms)")
    except Exception as e:
        log(f"❌ MinerU API Unreachable: {e}")

    # Check 2: OSS (TCP Ping via HTTP)
    try:
        t0 = time.time()
        requests.head(f"https://{OSS_HOST}", timeout=5)
        latency = (time.time() - t0) * 1000
        log(f"✅ Alibaba OSS ({OSS_HOST}): Reachable ({latency:.0f}ms)")
    except Exception as e:
        log(f"❌ Alibaba OSS Unreachable: {e}")

def test_full_upload():
    print("\n=== 2. Testing File Upload ===")
    
    if not os.path.exists(PDF_FILE):
        log(f"❌ Test file not found: {PDF_FILE}")
        return

    file_size = os.path.getsize(PDF_FILE)
    log(f"File: {os.path.basename(PDF_FILE)} ({file_size / 1024 / 1024:.2f} MB)")

    # Step A: Get URL
    log("Requesting upload URL...")
    try:
        res = requests.post(
            f"{API_BASE}/file-urls/batch",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {TOKEN}"
            },
            json={
                "files": [{"name": os.path.basename(PDF_FILE), "data_id": "debug_run"}],
                "model_version": "vlm"
            },
            timeout=10
        )
        if res.status_code != 200:
            log(f"❌ Failed to get URL: {res.text}")
            return
        
        data = res.json()["data"]
        upload_url = data["file_urls"][0]
        log("✅ Got upload URL")
        
    except Exception as e:
        log(f"❌ API Request Failed: {e}")
        return

    # Step B: Upload with chunks to track progress
    log("Starting upload...")
    try:
        with open(PDF_FILE, 'rb') as f:
            # Using requests loop to emulate progress
            sess = requests.Session()
            req = requests.Request('PUT', upload_url, data=f).prepare()
            
            # Send (this doesn't show chunk progress in requests easily without monitoring socket)
            # We'll just time it
            t0 = time.time()
            resp = sess.send(req, timeout=300)
            
            duration = time.time() - t0
            speed = (file_size / 1024) / duration
            
        if resp.status_code == 200:
            log(f"✅ Upload Success! Time: {duration:.1f}s, Speed: {speed:.1f} KB/s")
        else:
            log(f"❌ Upload Failed: Status {resp.status_code}")
            log(f"Response: {resp.text}")
            
    except requests.exceptions.ConnectionError as e:
        log(f"❌ Connection Error during upload: {e}")
        log("👉 This confirms your network connection to the server was reset/aborted.")
    except requests.exceptions.Timeout:
        log(f"❌ Connection Timed Out")
    except Exception as e:
        log(f"❌ Unexpected Error: {e}")

if __name__ == "__main__":
    check_network()
    test_full_upload()
    input("\nPress Enter to exit...")
