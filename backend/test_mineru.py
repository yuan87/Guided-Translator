import requests

token = "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJqdGkiOiIzNTQwMDM1NSIsInJvbCI6IlJPTEVfUkVHSVNURVIiLCJpc3MiOiJPcGVuWExhYiIsImlhdCI6MTc2ODY3NTkyMCwiY2xpZW50SWQiOiJsa3pkeDU3bnZ5MjJqa3BxOXgydyIsInBob25lIjoiIiwib3BlbklkIjpudWxsLCJ1dWlkIjoiZGJiNzkzYjktMmEwMy00NDBkLThmNDMtMmFkN2RmZGMyNDIxIiwiZW1haWwiOiIiLCJleHAiOjE3Njk4ODU1MjB9.vAETM8RutHWfk2B8wqZ-SJ8am9HzNRZU3BACsXBYSyrSi54s8MkhCZEG93Aq6EKKqm8t_rLLMwQUlc_BlzJOtg"

url = "https://mineru.net/api/v4/file-urls/batch"
header = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}"
}
data = {
    "files": [
        {"name": "test.pdf", "data_id": "test123"}
    ],
    "model_version": "vlm"
}

print("Step 1: Request upload URL...")
try:
    response = requests.post(url, headers=header, json=data, timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    
    if response.status_code == 200:
        result = response.json()
        if result["code"] == 0:
            batch_id = result["data"]["batch_id"]
            urls = result["data"]["file_urls"]
            print(f"\nSUCCESS!")
            print(f"batch_id: {batch_id}")
            print(f"upload_url: {urls[0][:100]}...")
        else:
            print(f"Error: {result.get('msg')}")
except Exception as e:
    print(f"Error: {e}")
