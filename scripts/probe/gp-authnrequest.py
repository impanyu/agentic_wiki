#!/usr/bin/env python3
"""Compare the SAML AuthnRequests that the UNL VPN portal and the US Central gateway generate.
Read-only: fetches each prelogin, decodes the embedded request and prints its key attributes."""
import base64, re, sys, urllib.parse, urllib.request, zlib
HOSTS = {"portal": ("nu-vpn.nebraska.edu", "/global-protect"),
         "gateway": ("us-central-g-universi.gpo2ojjg5cnn.gw.gpcloudservice.com", "/ssl-vpn")}
body = urllib.parse.urlencode({"tmp": "tmp", "kerberos-support": "yes", "ipv6-support": "yes", "clientVer": "4100",
        "clientos": "Linux", "os-version": "Linux", "clientgpversion": "6.3.3-1016", "default-browser": "0", "cas-support": "yes"}).encode()
for name, (host, path) in HOSTS.items():
    req = urllib.request.Request(f"https://{host}{path}/prelogin.esp", data=body, headers={"User-Agent": "PAN GlobalProtect"})
    xml = urllib.request.urlopen(req, timeout=20).read().decode()
    print(f"== {name}: " + " ".join(re.findall(r"<(status|saml-auth-method|region)>([^<]*)", xml).__str__().split()))
    m = re.search(r"<saml-request>([^<]+)", xml)
    if not m: print("  no saml-request:", xml[:200]); continue
    url = base64.b64decode(m.group(1)).decode()
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    print("  IdP endpoint:", urllib.parse.urlsplit(url)._replace(query="").geturl())
    print("  RelayState:", (q.get("RelayState") or ["-"])[0][:80])
    raw = base64.b64decode(q["SAMLRequest"][0])
    try: authn = zlib.decompress(raw, -15).decode()
    except Exception: authn = raw.decode(errors="replace")
    for attr in ("ID", "IssueInstant", "Destination", "AssertionConsumerServiceURL", "ProtocolBinding", "ForceAuthn", "IsPassive", "Version"):
        v = re.search(attr + r'="([^"]*)"', authn); print(f"  {attr}: {v.group(1) if v else '-'}")
    iss = re.search(r"<(?:saml2?:)?Issuer[^>]*>([^<]+)", authn); print("  Issuer:", iss.group(1) if iss else "-")
    nid = re.search(r"NameIDPolicy[^>]*", authn); print("  NameIDPolicy:", nid.group(0)[:160] if nid else "-")
