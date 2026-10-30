// Canonical model, C# mirror of packages/schema/src/{activity,wellness,bundle}.ts.
// CONTRACT — docs/CONTRACTS.md. Serialize ONLY with CanonicalJson.Options.
using System.Text.Json.Serialization;

namespace Pacelab.Canonical;

public static class SchemaInfo
{
    public const int SchemaVersion = 1;
}

/// <summary>Keys allowed in Samples.Channels. Same order as RAW_CHANNEL_KEYS in channels.ts.</summary>
public static class RawChannels
{
    public const string HeartRate = "heartRate";             // bpm
    public const string Speed = "speed";                     // m/s
    public const string Distance = "distance";               // m, cumulative
    public const string Altitude = "altitude";               // m
    public const string Lat = "lat";                         // degrees
    public const string Lon = "lon";                         // degrees
    public const string Cadence = "cadence";                 // run: steps/min (both feet); bike: rpm; swim: strokes/min
    public const string Power = "power";                     // W
    public const string Temperature = "temperature";         // °C
    public const string RespirationRate = "respirationRate"; // breaths/min
    public const string StepLength = "stepLength";           // m, device-measured only
    public const string VerticalOscillation = "verticalOscillation"; // m
    public const string GroundContactTime = "groundContactTime";     // s
    public const string VerticalRatio = "verticalRatio";     // %
    public const string GctBalance = "gctBalance";           // % left

    public static readonly IReadOnlyList<string> All =
    [
        HeartRate, Speed, Distance, Altitude, Lat, Lon, Cadence, Power, Temperature, RespirationRate,
        StepLength, VerticalOscillation, GroundContactTime, VerticalRatio, GctBalance,
    ];
}

[JsonConverter(typeof(JsonStringEnumConverter<Sport>))]
public enum Sport
{
    [JsonStringEnumMemberName("running")] Running,
    [JsonStringEnumMemberName("cycling")] Cycling,
    [JsonStringEnumMemberName("swimming")] Swimming,
    [JsonStringEnumMemberName("walking")] Walking,
    [JsonStringEnumMemberName("hiking")] Hiking,
    [JsonStringEnumMemberName("other")] Other,
}

[JsonConverter(typeof(JsonStringEnumConverter<SourceFormat>))]
public enum SourceFormat
{
    [JsonStringEnumMemberName("fit")] Fit,
    [JsonStringEnumMemberName("gpx")] Gpx,
    [JsonStringEnumMemberName("tcx")] Tcx,
    [JsonStringEnumMemberName("json")] Json,
}

[JsonConverter(typeof(JsonStringEnumConverter<LapTrigger>))]
public enum LapTrigger
{
    [JsonStringEnumMemberName("manual")] Manual,
    [JsonStringEnumMemberName("time")] Time,
    [JsonStringEnumMemberName("distance")] Distance,
    [JsonStringEnumMemberName("position")] Position,
    [JsonStringEnumMemberName("session_end")] SessionEnd,
    [JsonStringEnumMemberName("other")] Other,
}

[JsonConverter(typeof(JsonStringEnumConverter<Intensity>))]
public enum Intensity
{
    [JsonStringEnumMemberName("warmup")] Warmup,
    [JsonStringEnumMemberName("active")] Active,
    [JsonStringEnumMemberName("interval")] Interval,
    [JsonStringEnumMemberName("rest")] Rest,
    [JsonStringEnumMemberName("recovery")] Recovery,
    [JsonStringEnumMemberName("cooldown")] Cooldown,
    [JsonStringEnumMemberName("other")] Other,
}

[JsonConverter(typeof(JsonStringEnumConverter<SwimStroke>))]
public enum SwimStroke
{
    [JsonStringEnumMemberName("freestyle")] Freestyle,
    [JsonStringEnumMemberName("backstroke")] Backstroke,
    [JsonStringEnumMemberName("breaststroke")] Breaststroke,
    [JsonStringEnumMemberName("butterfly")] Butterfly,
    [JsonStringEnumMemberName("drill")] Drill,
    [JsonStringEnumMemberName("mixed")] Mixed,
    [JsonStringEnumMemberName("im")] Im,
    [JsonStringEnumMemberName("unknown")] Unknown,
}

public sealed record SourceRef
{
    public required string Provider { get; init; }          // "garmin" | "oura" | "file" | ...
    public string? ProviderId { get; init; }
    public required SourceFormat Format { get; init; }
    public string? Device { get; init; }
    public required string ImportedAt { get; init; }        // ISO-8601 UTC "yyyy-MM-ddTHH:mm:ssZ"
}

/// <summary>Fields shared by ActivitySummary (index) and Activity (full file).</summary>
public record ActivitySummary
{
    public required string Id { get; init; }                // "garmin:123" | "file:<sha256-16>"
    public int SchemaVersion { get; init; } = SchemaInfo.SchemaVersion;
    public required Sport Sport { get; init; }
    public required string SubSport { get; init; }          // lower_snake_case
    public string? Name { get; init; }
    public required string StartTime { get; init; }         // ISO-8601 UTC
    public int? TimezoneOffsetMin { get; init; }
    public required double ElapsedTimeS { get; init; }
    public required double MovingTimeS { get; init; }
    public double? DistanceM { get; init; }
    public double? AvgHr { get; init; }
    public double? MaxHr { get; init; }
    public double? AscentM { get; init; }
    public double? DescentM { get; init; }
    public double? Calories { get; init; }
    public double? PoolLengthM { get; init; }
    public required bool HasGps { get; init; }
    public required IReadOnlyList<string> Channels { get; init; }
    public required SourceRef Source { get; init; }
}

public sealed record Samples
{
    /// <summary>Seconds since StartTime, strictly increasing.</summary>
    public required IReadOnlyList<double> T { get; init; }
    /// <summary>Key = RawChannels.*; every array has T.Count entries; null = no reading.</summary>
    public required IReadOnlyDictionary<string, double?[]> Channels { get; init; }
    /// <summary>Namespaced "provider.name" channels, same length rule.</summary>
    public IReadOnlyDictionary<string, double?[]>? Extra { get; init; }
}

public sealed record Pause(double StartT, double EndT);

public sealed record Lap
{
    public required int Index { get; init; }
    public required double StartT { get; init; }
    public required double EndT { get; init; }
    public required double MovingTimeS { get; init; }
    public double? DistanceM { get; init; }
    public double? AvgHr { get; init; }
    public double? MaxHr { get; init; }
    public double? AvgSpeed { get; init; }
    public required LapTrigger Trigger { get; init; }
    public Intensity? Intensity { get; init; }
    public int? WorkoutStepIndex { get; init; }
}

public sealed record SwimLength
{
    public required int Index { get; init; }
    public required double StartT { get; init; }
    public required double EndT { get; init; }
    public int? Strokes { get; init; }
    public required SwimStroke Stroke { get; init; }
    public required bool Idle { get; init; }
}

public sealed record Activity : ActivitySummary
{
    public required Samples Samples { get; init; }
    public required IReadOnlyList<Pause> Pauses { get; init; }
    public required IReadOnlyList<Lap> Laps { get; init; }
    public IReadOnlyList<SwimLength>? SwimLengths { get; init; }

    /// <summary>Summary for the index (drops samples, pauses, laps, swim lengths).</summary>
    public ActivitySummary ToSummary() => new()
    {
        Id = Id, SchemaVersion = SchemaVersion, Sport = Sport, SubSport = SubSport, Name = Name, StartTime = StartTime,
        TimezoneOffsetMin = TimezoneOffsetMin, ElapsedTimeS = ElapsedTimeS, MovingTimeS = MovingTimeS,
        DistanceM = DistanceM, AvgHr = AvgHr, MaxHr = MaxHr, AscentM = AscentM, DescentM = DescentM,
        Calories = Calories, PoolLengthM = PoolLengthM, HasGps = HasGps, Channels = Channels, Source = Source,
    };
}

// ------------------------------------------------------------------ wellness

public sealed record Metric(double Value, string Source);

public sealed record SleepSummary
{
    public required string Source { get; init; }
    public required string BedtimeStart { get; init; }
    public required string BedtimeEnd { get; init; }
    public required double TotalSleepS { get; init; }
    public double? DeepS { get; init; }
    public double? RemS { get; init; }
    public double? LightS { get; init; }
    public double? AwakeS { get; init; }
    public double? LatencyS { get; init; }
    public double? EfficiencyPct { get; init; }
    public double? AvgHr { get; init; }
    public double? LowestHr { get; init; }
    public double? AvgHrvMs { get; init; }
    public double? AvgBreathRate { get; init; }
    public double? ProviderScore { get; init; }
}

public sealed record DailyWellness
{
    public required string Date { get; init; }              // "yyyy-MM-dd", local wake-up date
    public SleepSummary? Sleep { get; init; }
    public Metric? RestingHr { get; init; }
    public Metric? HrvMs { get; init; }
    public Metric? ProviderReadiness { get; init; }
    public Metric? TemperatureDeviationC { get; init; }
    public Metric? Steps { get; init; }
}

// ------------------------------------------------------------------ bundle

public sealed record ProfileEntry(string Id, string DisplayName);

public sealed record ProfilesFile
{
    public int SchemaVersion { get; init; } = SchemaInfo.SchemaVersion;
    public required IReadOnlyList<ProfileEntry> Profiles { get; init; }
}

public sealed record KeyInfo
{
    public int V { get; init; } = 1;
    public string Kdf { get; init; } = "PBKDF2-SHA256";
    public required int Iterations { get; init; }
    public required string Salt { get; init; }              // base64, 16 bytes
}

public sealed record IndexPayload
{
    public int SchemaVersion { get; init; } = SchemaInfo.SchemaVersion;
    public required string ProfileId { get; init; }
    public required string GeneratedAt { get; init; }
    public required IReadOnlyList<ActivitySummary> Activities { get; init; }   // newest first
    public required IReadOnlyList<DailyWellness> Wellness { get; init; }       // ascending by date
}
