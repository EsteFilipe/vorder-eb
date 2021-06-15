# Copyright 2017-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file
# except in compliance with the License. A copy of the License is located at
#
#     http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is distributed on an "AS IS"
# BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations under the License.

# This code is from https://github.com/awslabs/aws-support-tools/tree/master/Cognito/decode-verify-jwt

# Check this for a good explanation on JWT's https://www.youtube.com/watch?v=7Q17ubqLfaM

import sys
import json
import time
import urllib.request
from jose import jwk, jwt
from jose.utils import base64url_decode


def read_keys(public_keys_file_path):
    with open(public_keys_file_path, encoding='utf-8') as f:
        return json.load(f)['keys']


def main(token, app_client_id, keys):
    # get the kid from the headers prior to verification
    headers = jwt.get_unverified_headers(token)
    kid = headers['kid']
    # search for the kid in the downloaded public keys
    key_index = -1
    for i in range(len(keys)):
        if kid == keys[i]['kid']:
            key_index = i
            break
    if key_index == -1:
        return False, 'Public key not found in jwks.json'
    # construct the public key
    public_key = jwk.construct(keys[key_index])
    # get the last two sections of the token,
    # message and signature (encoded in base64)
    message, encoded_signature = str(token).rsplit('.', 1)
    # decode the signature
    decoded_signature = base64url_decode(encoded_signature.encode('utf-8'))
    # verify the signature
    if not public_key.verify(message.encode("utf8"), decoded_signature):
        return False, 'Signature verification failed'
    # since we passed the verification, we can now safely
    # use the unverified claims
    claims = jwt.get_unverified_claims(token)
    # additionally we can verify the token expiration
    if time.time() > claims['exp']:
        return False, 'Token is expired'
    # and the Audience  (use claims['client_id'] if verifying an access token)
    if claims['aud'] != app_client_id:
        return False, 'Token was not issued for this audience'
    # now we can use the claims
    return True, claims


if __name__ == '__main__':

    data = {
        'public_keys_file_path': sys.argv[1],
        'app_client_id': sys.argv[2],
        'token': sys.argv[3]
    }

    """
    data = {
        'public_keys_file_path': "C:/Users/35193/jwks.json",
        'app_client_id': "6le36scgu1ko22p6hgpvm08p8u",
        'token': "eyJraWQiOiI0cTdBSlFXY2d4eTdna1NUdCtmdTJlXC9JeVwvWXAwM3BrcHFDK3V2WnhtRjg9IiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiI1ZjdmZWFlOC01Nzg2LTQ2ZWQtYTZhZS1lZDgwZDA1MWY0MjEiLCJhdWQiOiI2bGUzNnNjZ3Uxa28yMnA2aGdwdm0wOHA4dSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJldmVudF9pZCI6ImUyMDY5MTlmLWI1MmItNDY5ZC04MTU0LWQzYzEzNzk0ZDA5NSIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNjIzNDkzODYyLCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb21cL3VzLWVhc3QtMV93S083aDNrR1UiLCJjb2duaXRvOnVzZXJuYW1lIjoiNWY3ZmVhZTgtNTc4Ni00NmVkLWE2YWUtZWQ4MGQwNTFmNDIxIiwiZXhwIjoxNjIzNDk3NDYyLCJpYXQiOjE2MjM0OTM4NjIsImVtYWlsIjoiZmlsaXBlLmIuYWxlaXhvQGdtYWlsLmNvbSJ9.c_nPYbExKv0uaUCRR_yuRA3TDbeeALA1OVlihEgOvMo8WbvsrWHxWSbxf1uQcuWsITH9HZdcCVGcrJw--BS67sSGH7fyO5EA6SRS2ic7SEs5YBEGddC6PSpZXRj1ERttj2xgpZ6rX7jMGSI9it8u3AVDZneGLtfrObRi2jrKos1RIQLwm1vuqMPFgtI0XQQP9AG9HOKysQ7GbtUnl-ouiOHM0YjKkr6RZdLBvl77qh9CN-gcaNpStb9vA4ihI3sLtF2XUVRMxbqmL70Qj8UI99l5qiEEUC4OIWkSbTb_CVRkcAKoxtJ2UdBQLpeMyoiEHhmOQtXlq7KwJJhImfMqtQ"
    }
    """

    keys = read_keys(data['public_keys_file_path'])

    try:
        status, output = main(data['token'], data['app_client_id'], keys)
    # unexpected errors in the validation
    except:
        status = False
        output = "JWT token failed to validate (probably there was no correspondence between object and signature)"

    out = json.dumps({"status": status,
                      "output": output})

    print(out)
    sys.stdout.flush()
