import httpx
import asyncio

async def test_uploads():
    test_content = b'%PDF-1.4 test content for upload testing'
    
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        
        # Test 1: transfer.sh
        print("\n1. Testing transfer.sh...")
        try:
            r = await client.put(
                'https://transfer.sh/test.pdf',
                content=test_content,
                headers={'Content-Type': 'application/pdf'}
            )
            print(f'Status: {r.status_code}')
            print(f'Response: {r.text[:300]}')
            if r.status_code == 200 and r.text.startswith('http'):
                print(f"SUCCESS! URL: {r.text.strip()}")
        except Exception as e:
            print(f'Error: {e}')
        
        # Test 2: 0x0.st
        print("\n2. Testing 0x0.st...")
        try:
            r = await client.post(
                'https://0x0.st',
                files={'file': ('test.pdf', test_content, 'application/pdf')}
            )
            print(f'Status: {r.status_code}')
            print(f'Response: {r.text[:300]}')
            if r.status_code == 200:
                print(f"SUCCESS! URL: {r.text.strip()}")
        except Exception as e:
            print(f'Error: {e}')
            
        # Test 3: litterbox.catbox.moe (24hr hosting)
        print("\n3. Testing litterbox.catbox.moe...")
        try:
            r = await client.post(
                'https://litterbox.catbox.moe/resources/internals/api.php',
                data={
                    'reqtype': 'fileupload',
                    'time': '24h'
                },
                files={'fileToUpload': ('test.pdf', test_content, 'application/pdf')}
            )
            print(f'Status: {r.status_code}')
            print(f'Response: {r.text[:300]}')
            if r.status_code == 200 and r.text.startswith('http'):
                print(f"SUCCESS! URL: {r.text.strip()}")
        except Exception as e:
            print(f'Error: {e}')

asyncio.run(test_uploads())
