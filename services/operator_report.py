"""Read aggregate operator metrics without placing credentials in command arguments or logs."""
import argparse
import getpass
import http.cookiejar
import json
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description='读取本机纸上声场运营汇总；不显示用户正文或密钥。')
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--days', type=int, choices=range(1, 91), default=7, metavar='1-90')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('端口需为 1–65535。')
    origin = 'http://127.0.0.1:' + str(args.port)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, data=None, method=None):
        req = urllib.request.Request(origin + path, data=None if data is None else json.dumps(data).encode(), method=method,
                                     headers={'Content-Type': 'application/json', 'Origin': origin})
        with opener.open(req, timeout=15) as response:
            return json.load(response)

    authenticated = False
    try:
        request('/api/session')
        code = getpass.getpass('管理员访问码（不会回显）：')
        request('/api/admin/session', {'accessCode': code})
        code = ''
        authenticated = True
        print(json.dumps(request('/api/admin/analytics?days=' + str(args.days)), ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as error:
        print('读取失败，HTTP ' + str(error.code) + '。请检查服务端管理员配置和访问码。')
        return 1
    except (urllib.error.URLError, TimeoutError, ValueError):
        print('无法读取统计，请先启动本地后端服务。')
        return 1
    finally:
        if authenticated:
            try:
                request('/api/admin/session', method='DELETE')
            except (urllib.error.URLError, TimeoutError, ValueError):
                pass
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
