// Pacelab sync CLI. Owner: Track A. Phase 0 ships only `crypto-vector`;
// Track A adds: sync, import-fit, oura-login, publish (see docs/tracks/track-a-ingest.md).
using System.Text;
using Pacelab.Canonical;

if (args.Length >= 1 && args[0] == "crypto-vector")
{
    // Writes the cross-language test vector used by packages/data/test/crypto.test.ts.
    // Usage: crypto-vector <in.json> <out-dir>
    var json = File.ReadAllBytes(args[1]);
    var outDir = args[2];
    Directory.CreateDirectory(outDir);
    var info = new KeyInfo { Iterations = 1000, Salt = Convert.ToBase64String(Encoding.ASCII.GetBytes("pacelab-salt-001")) };
    var crypto = BundleCrypto.FromPassphrase("correct horse battery staple", info);
    var iv = Encoding.ASCII.GetBytes("pacelab-iv-1");
    File.WriteAllText(Path.Combine(outDir, "keyinfo.json"), CanonicalJson.Serialize(info));
    File.WriteAllBytes(Path.Combine(outDir, "vector.enc"), crypto.Encrypt(json, iv));
    var roundTrip = crypto.Decrypt(File.ReadAllBytes(Path.Combine(outDir, "vector.enc")));
    if (!roundTrip.AsSpan().SequenceEqual(json)) throw new InvalidOperationException("round trip failed");
    Console.WriteLine($"wrote {outDir}/vector.enc and keyinfo.json");
    return 0;
}

if (args.Length >= 4 && args[0] == "decrypt")
{
    // decrypt <keyinfo.json> <file.enc> <passphrase>  -> prints JSON
    var info = CanonicalJson.Deserialize<KeyInfo>(File.ReadAllText(args[1]));
    var plain = BundleCrypto.FromPassphrase(args[3], info).Decrypt(File.ReadAllBytes(args[2]));
    Console.WriteLine(Encoding.UTF8.GetString(plain));
    return 0;
}

if (args.Length >= 2 && args[0] == "roundtrip")
{
    // Proves the C# records round-trip canonical JSON: roundtrip <activity.json> > out.json
    var activity = CanonicalJson.Deserialize<Activity>(File.ReadAllText(args[1]));
    Console.WriteLine(CanonicalJson.Serialize(activity));
    return 0;
}

Console.Error.WriteLine("usage: pacelab-sync crypto-vector <in.json> <out-dir> | decrypt <keyinfo.json> <file.enc> <passphrase> | roundtrip <activity.json>   (more commands: Track A)");
return 2;
