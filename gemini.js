const { GoogleGenAI } = require("@google/genai");
const genAi = new GoogleGenAI({ apiKey: `${process.env.API_KEY}` });

class Gemini {
  isUrl(str) {
    return /^(http(s)?:\/\/)?(www\.)?[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/.test(str);
  }
  getMimeType(response) {
    const contentType = response.headers["content-type"];
    return contentType ? contentType.split(';')[0] : 'application/octet-stream';
  }
  isAllowedMimes(mimeType) {
    return [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "audio/wav",
      "audio/mp3",
      "audio/x-m4a",
      "video/mp4",
      "video/mov",
    ].includes(mimeType);
  }
  async multimodal(promptArray) {
    const response = await genAi.models.generateContent({
      model: "gemini-2.0-flash",
      contents: promptArray,
    });
    return response;
  }
}

module.exports = new Gemini();