using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pacelab.Canonical;

/// <summary>The ONLY serializer settings allowed for canonical JSON (camelCase, omit null properties, keep nulls inside arrays).</summary>
public static class CanonicalJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
        NumberHandling = JsonNumberHandling.Strict,
    };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static byte[] SerializeToUtf8(object value) => JsonSerializer.SerializeToUtf8Bytes(value, value.GetType(), Options);

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options) ?? throw new JsonException($"null {typeof(T).Name}");

    /// <summary>"yyyy-MM-ddTHH:mm:ssZ" — the only timestamp format in canonical JSON.</summary>
    public static string Utc(DateTimeOffset t) => t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);
}
