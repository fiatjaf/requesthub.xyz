import re
import json

REPLACE = {
  True: 'true',
  False: 'false',
  None: 'null'
}


def dumps(data):
    t = type(data)
    if t is bool or t is None:
        return REPLACE[data]
    elif t is str:
        single = "'" in data
        double = '"' in data
        if single and double:
            return json.dumps(data)
        elif single:
            return '"' + data + '"'
        else:
            return "'" + data + "'"
    elif t is float or t is int:
        return str(data)
    elif t is dict:
        return '{' + ','.join([
            _dumpkey(k) + ':' + dumps(v) for k, v in data.items()
        ]) + '}'
    elif t is list:
        return '[' + ','.join([dumps(v) for v in data]) + ']'
    else:
        return 'null'


def _dumpkey(k):
    if notletter.search(k):
        return json.dumps(k)
    else:
        return str(k)


notletter = re.compile('\W')
