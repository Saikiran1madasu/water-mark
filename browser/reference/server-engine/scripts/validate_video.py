"""Check export integrity without claiming visual reconstruction accuracy."""
import argparse
import json
from pathlib import Path
import av


def inspect(path):
    with av.open(str(path)) as container:
        video=container.streams.video[0]
        info={'width':video.codec_context.width,'height':video.codec_context.height,'audioStreams':len(container.streams.audio),'duration':float(container.duration/av.time_base) if container.duration else None}
        timestamps=[float(frame.pts*frame.time_base) for frame in container.decode(video)]
    info['frames']=len(timestamps)
    return info,timestamps


def validate(source,output):
    original,a=inspect(source);result,b=inspect(output)
    if len(a)!=len(b):raise ValueError('Frame count changed.')
    if (original['width'],original['height'])!=(result['width'],result['height']):raise ValueError('Dimensions changed.')
    if original['audioStreams']!=result['audioStreams']:raise ValueError('Audio track count changed.')
    normalized_a=[t-a[0] for t in a];normalized_b=[t-b[0] for t in b]
    error=max((abs(x-y) for x,y in zip(normalized_a,normalized_b)),default=0)
    if error>.001:raise ValueError(f'Presentation timing changed by {error} seconds.')
    if any(y<=x for x,y in zip(b,b[1:])):raise ValueError('Repeated or backward timestamps.')
    if original['duration'] and result['duration'] and abs(original['duration']-result['duration'])>.06:raise ValueError('Export duration changed.')
    return {'source':original,'output':result,'maxTimestampErrorSeconds':error,'strictlyIncreasingTimestamps':True,'integrity':'passed','visualQuality':'requires review; no clean source for hidden region'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('output');parser.add_argument('--report')
    args=parser.parse_args();report=validate(args.source,args.output);text=json.dumps(report,indent=2)
    if args.report:Path(args.report).write_text(text)
    print(text)
