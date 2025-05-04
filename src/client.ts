import {
  Channel,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Interaction,
  Message,
  MessageFlags,
  MessageType,
  OmitPartialGroupDMChannel,
  VoiceBasedChannel,
  VoiceChannel,
  VoiceState,
  // @ts-ignore
} from "discord.js";
import fs from "node:fs/promises";
import {
  AudioReceiveStream,
  EndBehaviorType,
  joinVoiceChannel,
  VoiceConnection,
  VoiceReceiver,
} from "@discordjs/voice";
import { OpusEncoder } from "@discordjs/opus";
import {
  createWriteStream,
  appendFile,
  existsSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { transcribePcm } from "./util/transcribePcm";

export class DiscordAdapter {
  private _client: Client;
  private config: { CLIENT_ID?: string; CLIENT_TOKEN?: string };
  private connection?: VoiceConnection | null;
  private receiverListening: boolean = false;
  private nicoUID: string;
  private streams: Map<string, AudioReceiveStream> = new Map();

  constructor(private token?: string) {
    this.config = {
      CLIENT_ID: process.env.CLIENT_ID,
      CLIENT_TOKEN: this.token,
    };

    this.nicoUID = process.env.CZECHOPOLAK_ID ?? "";

    this._client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
  }

  public login = async () => {
    // @ts-ignore
    this._client.on(Events.ClientReady, async (ct) => {
      console.log(ct.user.tag);
    });

    this._client.on(Events.MessageCreate, this.onSlur);
    this._client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (newState?.member?.user.bot) {
        return;
      }

      this.onChannelJoined(oldState, newState);
      this.onChannelLeft(oldState, newState);
    });

    await this._client.login(this.config.CLIENT_TOKEN);
  };

  public onChannelJoined = async (
    oldState: VoiceState,
    newState: VoiceState,
  ) => {
    if (oldState.channelId || !newState.channelId) {
      return;
    }

    if (!newState?.channel?.isVoiceBased()) {
      return;
    }

    if (!this.connection) {
      this.connection = this.joinVoice(newState.channel);

      if (this.receiverListening) {
        return;
      }

      this.receiverListening = true;
      const receiver = this.connection.receiver;
      receiver.speaking.on("start", (userId) =>
        this.onUserSpeak(userId, receiver),
      );
    }

    console.log(
      `${newState?.member?.user.tag} wszedł na ${newState.channel?.name}`,
    );
  };

  private onUserSpeak = (uid: string, receiver: VoiceReceiver) => {
    if (this.streams.has(uid)) {
      return;
    }

    const decoder = new OpusEncoder(48000, 2);
    const dir = `./data/recordings/`;
    const file = `${uid}.pcm`;
    const filename = path.join(dir, file);

    const opus = receiver.subscribe(uid, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
    });

    this.streams.set(uid, opus);
    const out = createWriteStream(filename);

    opus.on("data", (chunk) => {
      out.write(decoder.decode(chunk));
    });

    opus.on("end", async () => {
      const processDir = `./data/processing/`;
      const processFilename = path.join(
        processDir,
        file.replace(".pcm", `.${Date.now()}.pcm`),
      );

      out.end();
      await fs.copyFile(filename, processFilename);
      try {
        const result = await transcribePcm(
          processFilename,
          (filename: string) => {
            fs.rm(filename);
          },
        );
        console.log(result);
      } catch (e) {
        console.error(e);
      }

      this.streams.delete(uid);
    });
  };

  public onChannelLeft = (oldState: VoiceState, newState: VoiceState) => {
    console.log(oldState?.channel?.members.size);
    if (!oldState.channelId || newState.channelId) {
      return;
    }

    if (oldState?.channel?.members.size !== 1) {
      return;
    }

    if (!oldState?.channel?.isVoiceBased()) {
      return;
    }

    if (!this.connection) {
      return;
    }

    this.connection.destroy();
    this.connection = null;

    console.log(
      `${oldState?.member?.user.tag} wyszedł z ${oldState.channel?.name}`,
    );
  };

  public joinVoice = (channel: VoiceBasedChannel) =>
    joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

  public onSlur = async (msg: OmitPartialGroupDMChannel<Message<boolean>>) => {
    if (!(await this.testContentForSlurs(msg.content))) {
      console.log("MSG INVALID");
      return;
    }

    if (msg.author.bot) {
      console.log("INVALID USER");
      return;
    }

    const guildId = process.env.FBI_ID;
    const targetUserId = process.env.CZECHOPOLAK_ID;
    const generalChannelId = process.env.GENERAL_CHANNEL_ID ?? "";

    const activeUser = await this.getUser(guildId, targetUserId);
    const channel = await this._client.channels.fetch(generalChannelId);

    if (channel?.isSendable()) {
      channel.send({
        embeds: [
          this.createErrorEmbed(`❌ Chomik bluzga po raz kolejny`),
          this.createContentEmbed(
            `@${msg.author.tag} powiedział:  ${msg.content}`,
          ),
        ],
      });
    }
  };

  private testContentForSlurs = async (text: string): Promise<boolean> => {
    const slurs = new Set(
      JSON.parse(await fs.readFile("./data/slurs.json", "utf8")),
    );

    const normalized = text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\W+/); // tokenizacja słów

    console.log(normalized);
    console.log(slurs);

    return normalized.some((w) => slurs.has(w));
  };

  private createErrorEmbed = (desc: string) => {
    return new EmbedBuilder()
      .setDescription(desc)
      .setColor(0xed4245)
      .setImage(
        "https://i1.sndcdn.com/artworks-nMoQsjqeYcqOfAnl-iDszCQ-t500x500.jpg",
      );
  };

  private createContentEmbed = (desc: string) => {
    return new EmbedBuilder().setDescription(desc).setColor("#2ec9dc");
  };

  public getChannels = async (guildId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }

    const guild = await this.getGuild(guildId);

    return guild.channels.fetch();
  };

  public getGuilds = async () => {
    return this._client.guilds.fetch();
  };

  public getGuild = async (guildId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }

    return this._client.guilds.fetch(guildId);
  };

  public getUser = async (guildId?: string, userId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }

    if (!userId) {
      throw new Error("Missing userId");
    }

    const guild = await this._client.guilds.fetch(guildId);
    return guild.members.fetch(userId);
  };

  public getUsers = async (guildId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }
    const guild = await this._client.guilds.fetch(guildId);
    return guild.members.fetch();
  };
}
