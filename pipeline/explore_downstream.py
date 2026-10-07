import sys, json, numpy as np, pathlib
sys.path.insert(0, 'pipeline')
import validate_lif as V
meta = V.meta; D = V.D
ct = np.asarray(meta['cell_types'], dtype=object)[np.fromfile(D/'type.u16', np.uint16)]
sc = np.asarray(meta['super_classes'], dtype=object)[np.fromfile(D/'superclass.u8', np.uint8)]
kl = np.asarray(meta['classes'], dtype=object)[np.fromfile(D/'klass.u8', np.uint8)]
import pandas as pd
def top(stim, T=1000):
    idx = np.asarray(V.groups[stim])
    # reuse run() internals: copy of run that returns counts
    rng = np.random.default_rng(0); N=V.N
    v = np.full(N, V.v0, np.float32); g = np.zeros(N, np.float32); ref = np.zeros(N, np.float32)
    ring = [np.zeros(N, np.float32) for _ in range(V.delay_steps)]; counts = np.zeros(N, np.int64)
    p = 150*V.dt/1000
    for s in range(int(T/V.dt)):
        sp_in = ring[s % V.delay_steps]; g += V.WT @ sp_in * V.w_syn; ring[s % V.delay_steps] = np.zeros(N, np.float32)
        kick = idx[rng.random(len(idx)) < p]; g[kick] += V.w_syn * V.P['poisson_gain']
        active = ref <= 0
        v[active] += V.dt * ((V.v0 - v[active] + g[active]) / V.tau_m); g -= V.dt * g / V.tau_s; ref -= V.dt
        fired = (v > V.vth) & active; v[fired] = V.v0; g[fired] = 0; ref[fired] = V.t_ref; counts[fired] += 1
        ring[(s + V.delay_steps) % V.delay_steps][fired] = 1.0
    stimset = np.zeros(N, bool); stimset[idx] = True
    df = pd.DataFrame({'ct': ct, 'sc': sc, 'kl': kl, 'hz': counts / (T/1000), 'stim': stimset})
    df = df[~df.stim & (df.hz > 0)]
    print(f"\n===== {stim} ({len(idx)}) : {len(df)} downstream neurons active")
    agg = df.groupby('ct').hz.agg(['count', 'mean']).sort_values('mean', ascending=False)
    print("top types:", agg.head(18).round(1).to_dict('index'))
    dn = df[df.sc.isin(['descending', 'motor'])].groupby(['sc','ct']).hz.agg(['count','mean']).sort_values('mean', ascending=False)
    print("descending/motor:", dn.head(15).round(1).to_dict('index'))
    print("by class:", df.groupby('kl').hz.sum().sort_values(ascending=False).head(8).round(0).to_dict())
for s in sys.argv[1:] or ['JO-F', 'JO-CE', 'JO-B', 'JO-A', 'ORN_DA1', 'pheromone_ORN', 'sugar']:
    top(s)
