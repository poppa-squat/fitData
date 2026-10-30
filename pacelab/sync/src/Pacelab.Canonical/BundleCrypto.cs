// Encrypted envelope, C# side. CONTRACT — docs/CONTRACTS.md §5.2.
// Byte-compatible with packages/data/src/crypto.ts (proven by fixtures/crypto/*).
//
//   file      = "PLB1" (4) || iv (12) || ciphertext || tag (16)
//   plaintext = gzip(UTF-8 JSON)
//   key       = PBKDF2-HMAC-SHA256(passphrase UTF-8, salt, iterations, 32 bytes) -> AES-256-GCM, no AAD
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace Pacelab.Canonical;

public sealed class BundleCrypto
{
    public const int DefaultIterations = 600_000;
    private static readonly byte[] Magic = "PLB1"u8.ToArray();
    private const int IvBytes = 12;
    private const int TagBytes = 16;

    private readonly byte[] _key;

    private BundleCrypto(byte[] key) => _key = key;

    public static KeyInfo NewKeyInfo(int iterations = DefaultIterations) =>
        new() { Iterations = iterations, Salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)) };

    public static BundleCrypto FromPassphrase(string passphrase, KeyInfo info)
    {
        if (info.V != 1 || info.Kdf != "PBKDF2-SHA256") throw new NotSupportedException($"Key info {info.V}/{info.Kdf}");
        var key = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(passphrase), Convert.FromBase64String(info.Salt), info.Iterations, HashAlgorithmName.SHA256, 32);
        return new BundleCrypto(key);
    }

    public byte[] EncryptJson(object value, byte[]? iv = null) => Encrypt(CanonicalJson.SerializeToUtf8(value), iv);

    public byte[] Encrypt(byte[] utf8Json, byte[]? iv = null)
    {
        iv ??= RandomNumberGenerator.GetBytes(IvBytes);
        if (iv.Length != IvBytes) throw new ArgumentException("IV must be 12 bytes", nameof(iv));

        byte[] plain;
        using (var ms = new MemoryStream())
        {
            using (var gz = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true)) gz.Write(utf8Json);
            plain = ms.ToArray();
        }

        var output = new byte[Magic.Length + IvBytes + plain.Length + TagBytes];
        Magic.CopyTo(output, 0);
        iv.CopyTo(output, Magic.Length);
        using var aes = new AesGcm(_key, TagBytes);
        aes.Encrypt(
            iv,
            plain,
            output.AsSpan(Magic.Length + IvBytes, plain.Length),
            output.AsSpan(Magic.Length + IvBytes + plain.Length, TagBytes));
        return output;
    }

    /// <summary>Returns the decrypted UTF-8 JSON. Throws CryptographicException on wrong passphrase.</summary>
    public byte[] Decrypt(byte[] file)
    {
        if (file.Length < Magic.Length + IvBytes + TagBytes || !file.AsSpan(0, Magic.Length).SequenceEqual(Magic))
            throw new InvalidDataException("Not a Pacelab encrypted file (bad magic)");
        var iv = file.AsSpan(Magic.Length, IvBytes);
        var ctLen = file.Length - Magic.Length - IvBytes - TagBytes;
        var plain = new byte[ctLen];
        using var aes = new AesGcm(_key, TagBytes);
        aes.Decrypt(iv, file.AsSpan(Magic.Length + IvBytes, ctLen), file.AsSpan(file.Length - TagBytes, TagBytes), plain);
        using var gz = new GZipStream(new MemoryStream(plain), CompressionMode.Decompress);
        using var outMs = new MemoryStream();
        gz.CopyTo(outMs);
        return outMs.ToArray();
    }
}

public static class BundlePaths
{
    /// <summary>Must match activityFileName() in packages/schema/src/bundle.ts.</summary>
    public static string ActivityFileName(string id)
    {
        var sb = new StringBuilder(id.Length + 4);
        foreach (var ch in id) sb.Append(char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' or '-' ? ch : '_');
        return sb.Append(".enc").ToString();
    }

    public static string ProfilesFile(string dataRoot) => Path.Combine(dataRoot, "profiles.json");
    public static string KeyInfo(string dataRoot, string profileId) => Path.Combine(dataRoot, profileId, "keyinfo.json");
    public static string Index(string dataRoot, string profileId) => Path.Combine(dataRoot, profileId, "index.enc");
    public static string Activity(string dataRoot, string profileId, string activityId) =>
        Path.Combine(dataRoot, profileId, "activities", ActivityFileName(activityId));
}
